# stt-mvp

A small, local, privacy-friendly speech-to-text **dictation** app (Typeless-style):
press a hotkey, talk, and your words are transcribed and pasted into whatever app
is focused. Runs **Whisper on-device via native `whisper.cpp` with GPU**, so it's
both accurate and fast. Nothing is sent to the cloud.

Default model is **`small`** (multilingual, 181MB, ~0.3s for a 10s clip) — a good
accuracy/size balance. Language is **auto-detected** and the app transcribes
(not translates), so mixed **Chinese + English** dictation works: Chinese stays
Chinese, English stays English. Swap `WHISPER_MODEL` for `medium` if you need
higher accuracy on hard audio (accents, jargon, noise); medium is still fast
(~0.8s) since the model stays warm.

---

## Architecture

```
┌─────────────────────────── Electron App ───────────────────────────┐
│                                                                     │
│  Renderer process (Chromium)         Main process (Node)            │
│  src/renderer.ts                     src/main.ts                    │
│  ┌────────────────────┐              ┌──────────────────────────┐   │
│  │ getUserMedia record │              │ globalShortcut (hotkey)   │   │
│  │ 16kHz mono capture  │              │ spawn/manage whisper-server│  │
│  │ encode WAV          │   IPC        │ HTTP call → transcribe    │   │
│  │ show status/result  │ ◀──preload──▶│ cleanup (cleanup.ts)      │   │
│  └────────────────────┘   bridge     │ clipboard + paste keystroke│  │
│                                       └────────────┬─────────────┘   │
└────────────────────────────────────────────────────┼───────────────┘
                                                      │ POST /inference (HTTP)
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ whisper-server (native binary) │
                                       │ whisper.cpp + GPU (Metal/CUDA/CPU)│
                                       │ model stays warm in VRAM        │
                                       └──────────────────────────────┘
```

**Why this shape:** the heavy STT runs in a persistent native `whisper-server`
process the app launches at startup. The model stays loaded on the GPU, so each
dictation only pays inference time (~0.8s) instead of reloading (~9s). Electron
itself touches **no native node modules**, so there's no ABI rebuild — porting to
another OS is just swapping the `whisper-server` binary.

### What happens on one dictation

1. **Trigger** — you press `⌘/Ctrl+Shift+Space`; main's `globalShortcut` sends `hotkey-toggle` to the renderer.
2. **Record** (renderer) — `getUserMedia` + `AudioContext({sampleRate:16000})` + `ScriptProcessorNode` collect Float32 PCM; a timer shows elapsed seconds.
3. **Stop + encode** (renderer) — press again → concat samples → `encodeWav()` → 16-bit WAV `ArrayBuffer`.
4. **IPC** — `bridge.transcribe(wav)` sends the bytes to main.
5. **Transcribe** (main) — POST the WAV to `http://127.0.0.1:8910/inference` (with `translate=false`, `language=auto`); whisper-server runs Whisper on the GPU and returns text in the spoken language.
6. **Cleanup** (main) — `cleanupTranscript()` strips filler words, collapses stutters, normalizes whitespace.
7. **Inject** (main) — `pasteIntoActiveApp()`: save clipboard → write text → send paste keystroke → restore clipboard.
8. **Echo** — returns `{text, ms, note}`; renderer shows the result and latency.

### whisper-server lifecycle

- Spawned at `app.whenReady`; `startServer()` polls `GET /` until ready (one-time model load + GPU init).
- Kept warm for the session → fast per-utterance inference.
- Killed on `will-quit`.

---

## Prerequisites

- Node 18+ (tested on 24)
- **whisper.cpp** providing a `whisper-server` binary (see platform setup below)
- **A ggml model** (default `small`, multilingual, quantized — handles zh + en):
  ```bash
  mkdir -p models
  curl -L -o models/ggml-small-q5_1.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
  # optional, higher accuracy: ggml-medium-q5_0.bin (multilingual, 514MB)
  ```

### macOS

```bash
brew install whisper-cpp     # Metal GPU; puts `whisper-server` on PATH
```

The macOS paste keystroke needs **Accessibility** permission
(System Settings → Privacy & Security → Accessibility → enable Electron / your terminal).
Without it, text still lands on the clipboard for manual paste.

---

## Run

```bash
npm install
npm start          # builds, launches Electron, auto-starts whisper-server
```

Press **⌘/Ctrl+Shift+Space** to start recording, press again to stop → it
transcribes and pastes into the focused app.

## Self-test (no microphone)

```bash
npm run test:stt   # transcribes bundled jfk.wav via the managed server, prints warm latency
```

Verified locally on Apple M4 / Metal: `small` (multilingual) **warm ~280ms**, `medium` warm ~780ms.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `WHISPER_SERVER_BIN` | `whisper-server` (PATH) | path to the whisper.cpp server binary |
| `WHISPER_MODEL` | `models/ggml-small-q5_1.bin` | ggml model file (swap for medium / multilingual) |
| `WHISPER_PORT` | `8910` | local server port |

---

## Developing / running on Windows

The codebase is already cross-platform; the paste path, hotkey, audio capture,
build, and IPC all work on Windows unchanged. Only **two things** need attention,
and **one of them is just configuration, not code**.

### 1. Provide a Windows `whisper-server.exe` (required)

There is no Homebrew on Windows, so the default `whisper-server` (PATH lookup)
won't resolve. Get a prebuilt whisper.cpp release and point the app at it.

**Official prebuilts** — <https://github.com/ggml-org/whisper.cpp/releases>
(verified: the zips contain `whisper-server.exe` + `ggml*.dll` / `whisper.dll`):

| Build | GPU | Arch | Use when |
|---|---|---|---|
| `whisper-cublas-12.4.0-bin-x64.zip` | CUDA | x64 | **NVIDIA GPU** — fastest |
| `whisper-blas-bin-Win32.zip` | none (CPU+BLAS) | 32-bit | AMD / Intel / no GPU |
| `whisper-bin-Win32.zip` | none (CPU) | 32-bit | fallback |

> ⚠️ There is **no official Vulkan build** for Windows. So GPU acceleration on
> **AMD / Intel** GPUs is not available from the official downloads — you'd either
> run CPU (small model is fine on CPU; medium is slower), build whisper.cpp from
> source with `-DGGML_VULKAN=1`, or use a community Vulkan prebuilt (unofficial —
> vet it yourself). On **NVIDIA**, use the CUDA (`cublas`) build.

Steps:

1. Download the build that matches your GPU, unzip to e.g. `C:\tools\whisper\`.
   Keep **all the DLLs next to `whisper-server.exe`** — the app spawns the server
   with its own directory as the working dir so Windows resolves them.
2. Point the env vars at the binary and model (PowerShell):
   ```powershell
   $env:WHISPER_SERVER_BIN = "C:\tools\whisper\whisper-server.exe"
   $env:WHISPER_MODEL      = "C:\path\to\models\ggml-small-q5_1.bin"
   npm start
   ```
   (The model `.bin` is the same as on macOS — ggml format is OS-independent.)

### 2. Paste keystroke — already handled, with one caveat

`src/main.ts` already branches on `process.platform`: Windows uses PowerShell
`SendKeys ^v` (Ctrl+V). No change needed. Caveats:

- First paste has slight PowerShell startup latency (~100–300ms). Fine for an MVP.
  For snappier/robust injection later, swap to `nut.js` (native, needs `@electron/rebuild`).
- If the **target app runs as Administrator**, a non-elevated app cannot send keys
  into it (Windows UIPI). Run both at the same integrity level, or rely on the
  clipboard fallback.

### Nothing else changes

- Hotkey: `CommandOrControl+Shift+Space` resolves to **Ctrl+Shift+Space** on Windows.
- Mic capture, WAV encode, IPC, esbuild build, `fetch`/`FormData` — all identical.

### Packaging a Windows installer (later)

Use `electron-builder`. Bundle as `extraResources`: the `whisper-server.exe` +
its DLLs, and the model `.bin`. At runtime, set `WHISPER_SERVER_BIN` /
`WHISPER_MODEL` to the unpacked resource paths (`process.resourcesPath`). Sign the
`.exe` to avoid SmartScreen warnings for internal distribution.

---

## Status

| Part | State |
|---|---|
| Native whisper.cpp via managed server (multilingual small default) | ✅ verified (warm ~0.3s, macOS/Metal) |
| Deterministic cleanup (filler / stutter / spaces) | ✅ |
| Clipboard + auto-paste (macOS osascript / Windows SendKeys) | ✅ |
| Toggle global hotkey | ✅ |
| Mic capture → WAV → IPC | ✅ wired (interactive test with a real mic) |
| Windows run | ⚙️ set `WHISPER_SERVER_BIN` to a prebuilt (NVIDIA: cublas x64; else CPU Win32) — see above |

## Next steps (not yet wired)

- **Custom vocabulary**: whisper-server accepts a `prompt` field (initial_prompt) —
  add it to the FormData in `main.ts` to bias technical terms (~50 fit; 224-token cap).
- **AI formatting**: add an LLM post-process step after cleanup (local Ollama / OpenAI-compatible).
- **Smaller/faster model**: swap to `ggml-small` / `ggml-base` if Medium is heavier than needed.
- **Push-to-talk** (hold to talk): add `uiohook-napi` (`globalShortcut` only gives press, not release).
- **Polish**: VAD auto-stop, settings UI, tray icon.

## Files

- `src/main.ts` — manages whisper-server, transcribe (HTTP), cleanup, paste, hotkey
- `src/renderer.ts` — mic capture + WAV encode + IPC
- `src/cleanup.ts` — deterministic filler/stutter cleanup
- `src/preload.ts` — IPC bridge (contextBridge)
- `src/index.html` — minimal UI
- `build.mjs` — esbuild bundling (main / preload / renderer)
