import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bridge", {
  onHotkeyToggle: (cb: () => void) => ipcRenderer.on("hotkey-toggle", () => cb()),
  transcribe: (wav: ArrayBuffer): Promise<{ text: string; ms: number; note: string }> =>
    ipcRenderer.invoke("transcribe", wav),
  log: (msg: string) => ipcRenderer.send("log", msg),
});
