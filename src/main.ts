import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
} from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cleanupTranscript } from "./cleanup";

const HOTKEY = "CommandOrControl+Shift+Space";
const SELFTEST = process.argv.includes("--selftest");
const PORT = Number(process.env.WHISPER_PORT ?? 8910);

// Native whisper.cpp server: smooth Medium-class STT with GPU (Metal/Vulkan).
// macOS: `brew install whisper-cpp` puts whisper-server on PATH.
// Windows: bundle a Vulkan prebuilt and set WHISPER_SERVER_BIN.
const WHISPER_BIN = process.env.WHISPER_SERVER_BIN ?? "whisper-server";
const MODEL_PATH =
  process.env.WHISPER_MODEL ?? join(__dirname, "..", "models", "ggml-small-q5_1.bin");

let win: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let serverReady: Promise<void> | null = null;

function startServer(): Promise<void> {
  // When WHISPER_SERVER_BIN is a real path (e.g. a bundled Windows .exe), run
  // from its directory so the OS resolves the colocated DLLs next to it.
  const binIsPath = WHISPER_BIN.includes("/") || WHISPER_BIN.includes("\\");
  server = spawn(
    WHISPER_BIN,
    ["-m", MODEL_PATH, "--host", "127.0.0.1", "--port", String(PORT), "-nt"],
    { stdio: ["ignore", "pipe", "pipe"], cwd: binIsPath ? dirname(WHISPER_BIN) : undefined },
  );
  server.stderr?.on("data", (d: Buffer) => {
    const s = d.toString().trim();
    if (s) console.log(`[whisper-server] ${s.split("\n").pop()}`);
  });
  server.on("exit", (code) => console.log(`whisper-server exited (${code})`));

  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 90_000;
    const poll = async () => {
      try {
        await fetch(`http://127.0.0.1:${PORT}/`);
        console.log("whisper-server ready");
        resolve();
      } catch {
        if (Date.now() > deadline) reject(new Error("whisper-server failed to start"));
        else setTimeout(poll, 500);
      }
    };
    setTimeout(poll, 500);
  });
}

async function transcribe(wav: ArrayBuffer): Promise<string> {
  if (!serverReady) serverReady = startServer();
  await serverReady;
  const fd = new FormData();
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  fd.append("response_format", "text");
  // Transcribe (NOT translate) and auto-detect language, so Chinese stays Chinese
  // and English stays English in mixed zh/en dictation.
  fd.append("translate", "false");
  fd.append("language", "auto");
  const res = await fetch(`http://127.0.0.1:${PORT}/inference`, { method: "POST", body: fd });
  const raw = (await res.text()).trim();
  return cleanupTranscript(raw, "en");
}

function pasteIntoActiveApp(text: string): Promise<{ pasted: boolean; note: string }> {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  return new Promise((resolve) => {
    const restore = () => setTimeout(() => clipboard.writeText(prev), 400);
    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "v" using command down'],
        (err) => {
          restore();
          resolve(err ? { pasted: false, note: `osascript failed (grant Accessibility): ${err.message}` } : { pasted: true, note: "pasted" });
        },
      );
    } else if (process.platform === "win32") {
      const ps = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")';
      execFile("powershell", ["-NoProfile", "-Command", ps], (err) => {
        restore();
        resolve(err ? { pasted: false, note: `SendKeys failed: ${err.message}` } : { pasted: true, note: "pasted" });
      });
    } else {
      resolve({ pasted: false, note: "clipboard only" });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 380,
    title: "STT MVP (native whisper.cpp)",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "index.html"));
}

async function runSelftest() {
  const t0 = Date.now();
  try {
    const buf = await readFile(join(__dirname, "jfk.wav"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    // warm + measure
    await transcribe(ab);
    const w0 = Date.now();
    const text = await transcribe(ab);
    const warm = Date.now() - w0;
    const ok = /ask not what your country/i.test(text);
    console.log(`\n=== SELFTEST ${ok ? "PASS" : "FAIL"} (warm ${warm}ms, total ${Date.now() - t0}ms) ===`);
    console.log(`transcript: "${text}"`);
  } catch (e: any) {
    console.log(`\n=== SELFTEST FAIL === ${e?.message ?? e}`);
  } finally {
    setTimeout(() => app.quit(), 200);
  }
}

app.whenReady().then(async () => {
  serverReady = startServer();

  if (SELFTEST) {
    await runSelftest();
    return;
  }

  createWindow();

  const ok = globalShortcut.register(HOTKEY, () => win?.webContents.send("hotkey-toggle"));
  if (!ok) console.error(`Failed to register hotkey ${HOTKEY}`);
  console.log(`Hotkey: ${HOTKEY}`);

  ipcMain.handle("transcribe", async (_e, wav: ArrayBuffer) => {
    const t0 = Date.now();
    const text = await transcribe(wav);
    const ms = Date.now() - t0;
    if (!text) return { text: "", ms, note: "empty" };
    const res = await pasteIntoActiveApp(text);
    console.log(`[result ${ms}ms] "${text}" -> ${res.note}`);
    return { text, ms, note: res.note };
  });

  ipcMain.on("log", (_e, msg: string) => console.log(`[renderer] ${msg}`));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  server?.kill();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
