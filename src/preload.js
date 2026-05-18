const { contextBridge, ipcRenderer } = require("electron");

let markdown;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

try {
  const MarkdownIt = require("markdown-it");
  const markdownItKatex = require("markdown-it-katex");
  markdown = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true
  }).use(markdownItKatex);
} catch (error) {
  markdown = {
    render: (text) => `<p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`
  };
}

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
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  renderMarkdown: (text) => markdown.render(String(text || ""))
});
