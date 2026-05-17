const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aimini", {
  captureScreenshot: () => ipcRenderer.invoke("assistant:capture"),
  ask: (message) => ipcRenderer.invoke("assistant:ask", message),
  askStream: (message) => ipcRenderer.send("assistant:ask-stream", message),
  onStreamStart: (callback) => ipcRenderer.on("assistant:stream-start", (_event, item) => callback(item)),
  onStreamDelta: (callback) => ipcRenderer.on("assistant:stream-delta", (_event, payload) => callback(payload)),
  onStreamDone: (callback) => ipcRenderer.on("assistant:stream-done", (_event, item) => callback(item)),
  onStreamError: (callback) => ipcRenderer.on("assistant:stream-error", (_event, payload) => callback(payload)),
  selectCaptureArea: (rect) => ipcRenderer.send("capture:select", rect),
  cancelCaptureArea: () => ipcRenderer.send("capture:cancel"),
  getCapturePreview: () => ipcRenderer.invoke("capture:get-preview"),
  setExpanded: (expanded) => ipcRenderer.invoke("window:set-expanded", expanded),
  setPreview: (visible) => ipcRenderer.invoke("window:set-preview", visible),
  setCollapsed: (collapsed) => ipcRenderer.invoke("window:set-collapsed", collapsed),
  getHistory: () => ipcRenderer.invoke("history:get"),
  onHistoryUpdated: (callback) => {
    ipcRenderer.on("history:updated", (_event, history) => callback(history));
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings)
});
