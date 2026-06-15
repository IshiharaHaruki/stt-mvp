// Renderer: capture mic at 16kHz mono, encode WAV, hand to main for native
// whisper.cpp transcription + paste. No model runs here — it's all in the
// persistent whisper-server (GPU), so this stays lightweight.

declare global {
  interface Window {
    bridge: {
      onHotkeyToggle: (cb: () => void) => void;
      transcribe: (wav: ArrayBuffer) => Promise<{ text: string; ms: number; note: string }>;
      log: (msg: string) => void;
    };
  }
}

const SAMPLE_RATE = 16000;
const $ = (id: string) => document.getElementById(id)!;
const statusEl = $("status");
const transcriptEl = $("transcript");
const setStatus = (s: string) => (statusEl.textContent = s);

let recording = false;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let chunks: Float32Array[] = [];
let recTimer: number | null = null;

/** Float32 PCM -> 16-bit WAV (mono). */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

async function startRecording() {
  chunks = [];
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const src = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(processor);
  processor.connect(audioCtx.destination);
  recording = true;
  const t0 = performance.now();
  recTimer = window.setInterval(
    () => setStatus(`🔴 recording ${((performance.now() - t0) / 1000).toFixed(1)}s — press hotkey to stop`),
    100,
  );
}

async function stopRecording() {
  recording = false;
  if (recTimer !== null) { clearInterval(recTimer); recTimer = null; }
  processor?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();

  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total === 0) { setStatus("idle (no audio)"); return; }
  const samples = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { samples.set(c, off); off += c.length; }

  setStatus(`transcribing ${(total / SAMPLE_RATE).toFixed(1)}s…`);
  const wav = encodeWav(samples, SAMPLE_RATE);
  const res = await window.bridge.transcribe(wav);
  transcriptEl.textContent = res.text || "(empty)";
  setStatus(`done in ${res.ms}ms — ${res.note}`);
}

async function toggle() {
  try {
    if (!recording) await startRecording();
    else await stopRecording();
  } catch (e: any) {
    window.bridge.log(`toggle error: ${e?.message ?? e}`);
    setStatus(`error: ${e?.message ?? e}`);
  }
}

window.bridge.onHotkeyToggle(() => void toggle());
setStatus("idle — press ⌘/Ctrl+Shift+Space to dictate");
