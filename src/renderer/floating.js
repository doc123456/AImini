const promptInput = document.getElementById("prompt");
const captureButton = document.getElementById("capture");
const toggleButton = document.getElementById("toggle");
const clearImageButton = document.getElementById("clearImage");
const imageBadge = document.getElementById("imageBadge");
const appRoot = document.getElementById("app");
const wakeButton = document.getElementById("wakeButton");
const previewPanel = document.getElementById("preview");
const historyPanel = document.getElementById("history");

let expanded = false;
let capturing = false;
let pendingScreenshots = [];
let historyItems = [];
let previewTimer;
let previewMuted = false;
let idleTimer;
let collapsed = false;
let streaming = false;

function hasDraft() {
  return promptInput.value.trim().length > 0 || pendingScreenshots.length > 0;
}

function canIdleCollapse() {
  return !collapsed && !expanded && !capturing && !streaming && !hasDraft() && previewPanel.hidden;
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!canIdleCollapse()) return;
  idleTimer = setTimeout(() => {
    if (canIdleCollapse()) collapseToButton();
  }, 8000);
}

function wakeFromButton() {
  if (!collapsed) {
    resetIdleTimer();
    return;
  }
  collapsed = false;
  appRoot.classList.remove("collapsed");
  window.aimini.setCollapsed(false);
  promptInput.focus();
  resetIdleTimer();
}

function collapseToButton() {
  if (!canIdleCollapse()) return;
  collapsed = true;
  clearTimeout(idleTimer);
  appRoot.classList.add("collapsed");
  window.aimini.setCollapsed(true);
}

function noteActivity() {
  if (collapsed) wakeFromButton();
  resetIdleTimer();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateScreenshotBadge() {
  const hasImage = pendingScreenshots.length > 0;
  imageBadge.textContent = hasImage ? `▧ ${pendingScreenshots.length}` : "▧";
  imageBadge.hidden = !hasImage;
  clearImageButton.hidden = !hasImage;
  document.querySelector(".input-wrap").classList.toggle("has-images", hasImage);
  resetIdleTimer();
}

function addPendingScreenshot(base64) {
  if (!base64) return;
  pendingScreenshots.push(base64);
  updateScreenshotBadge();
}

function resizeScreenshot(base64, maxSide = 1280) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      if (scale >= 1) {
        resolve(base64);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
    };
    image.onerror = () => resolve(base64);
    image.src = `data:image/png;base64,${base64}`;
  });
}

function clearPendingScreenshots() {
  pendingScreenshots = [];
  updateScreenshotBadge();
}

function renderHistory() {
  if (!historyItems.length) {
    historyPanel.innerHTML = '<p class="empty">暂无历史记录</p>';
    return;
  }

  historyPanel.innerHTML = historyItems.map((item) => `
    <article class="history-item">
      <div class="time">${escapeHtml(item.createdAt)}</div>
      <div class="question">${item.hasScreenshot ? `<span class="mini-image">▧ ${item.screenshotCount || 1}</span>` : ""}${escapeHtml(item.prompt)}</div>
      <div class="answer markdown-body">${renderMarkdown(stripThinking(item.answer))}</div>
    </article>
  `).join("");
}

function renderMarkdown(text) {
  return window.aimini.renderMarkdown(text);
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trimStart();
}

function showPreview(text) {
  if (expanded || previewMuted) return;
  const visibleText = stripThinking(text);
  if (!visibleText) return;
  previewPanel.hidden = false;
  previewPanel.innerHTML = renderMarkdown(visibleText);
  previewPanel.scrollTop = previewPanel.scrollHeight;
  window.aimini.setPreview(true);
  resetIdleTimer();
}

function collapsePreview() {
  clearTimeout(previewTimer);
  previewPanel.hidden = true;
  previewPanel.innerHTML = "";
  window.aimini.setPreview(false);
  resetIdleTimer();
}

function hidePreviewSoon() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (expanded) return;
    collapsePreview();
  }, 5000);
}

async function refreshHistory() {
  historyItems = await window.aimini.getHistory();
  renderHistory();
}

async function toggleHistory() {
  wakeFromButton();
  expanded = !expanded;
  historyPanel.hidden = !expanded;
  collapsePreview();
  toggleButton.textContent = expanded ? "⌃" : "⌄";
  await window.aimini.setExpanded(expanded);
  if (expanded) await refreshHistory();
}

async function addScreenshot() {
  wakeFromButton();
  if (capturing) return;
  previewMuted = true;
  collapsePreview();
  capturing = true;
  captureButton.textContent = "...";
  captureButton.disabled = true;
  try {
    const screenshotBase64 = await window.aimini.captureScreenshot();
    addPendingScreenshot(screenshotBase64);
    promptInput.focus();
  } catch (error) {
    const message = error.message || String(error);
    if (!message.includes("已取消截图")) {
      historyItems = [{
        createdAt: new Date().toLocaleString(),
        prompt: "添加截图",
        answer: message
      }, ...historyItems].slice(0, 20);
      renderHistory();
      if (!expanded) await toggleHistory();
    }
  } finally {
    capturing = false;
    captureButton.textContent = "▣";
    captureButton.disabled = false;
  }
}

function upsertHistoryItem(item) {
  const index = historyItems.findIndex((historyItem) => historyItem.id === item.id);
  if (index >= 0) {
    historyItems[index] = { ...historyItems[index], ...item };
  } else {
    historyItems = [item, ...historyItems].slice(0, 20);
  }
  renderHistory();
}

async function sendMessage() {
  wakeFromButton();
  const prompt = promptInput.value.trim();
  if ((!prompt && !pendingScreenshots.length) || streaming) return;
  previewMuted = false;
  streaming = true;
  if (expanded) {
    expanded = false;
    historyPanel.hidden = true;
    toggleButton.textContent = "⌄";
    window.aimini.setExpanded(false);
  }

  const requestId = Date.now();
  const screenshots = await Promise.all(pendingScreenshots.map((screenshot) => resizeScreenshot(screenshot)));
  const localItem = {
    id: requestId,
    createdAt: new Date().toLocaleString(),
    prompt: prompt || "请分析这些截图。",
    screenshotCount: screenshots.length,
    hasScreenshot: screenshots.length > 0,
    answer: "正在回答..."
  };

  promptInput.value = "";
  clearPendingScreenshots();
  upsertHistoryItem(localItem);
  previewPanel.hidden = false;
  previewPanel.innerHTML = renderMarkdown("正在回答...");
  window.aimini.setPreview(true);
  resetIdleTimer();

  window.aimini.askStream({ requestId, prompt, screenshots });
}

document.addEventListener("mousemove", resetIdleTimer);
document.addEventListener("mousedown", noteActivity);
document.addEventListener("keydown", noteActivity);
promptInput.addEventListener("input", resetIdleTimer);
wakeButton.addEventListener("click", wakeFromButton);
captureButton.addEventListener("click", addScreenshot);
imageBadge.addEventListener("click", clearPendingScreenshots);
clearImageButton.addEventListener("click", clearPendingScreenshots);
toggleButton.addEventListener("click", toggleHistory);
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendMessage();
});

window.aimini.onHistoryUpdated((items) => {
  historyItems = items;
  renderHistory();
});

window.aimini.onStreamStart((item) => {
  upsertHistoryItem({ ...item, answer: item.answer || "正在回答..." });
});

window.aimini.onStreamDelta(({ requestId, answer }) => {
  streaming = true;
  resetIdleTimer();
  const item = historyItems.find((historyItem) => historyItem.id === requestId);
  if (!item) return;
  item.answer = answer;
  showPreview(answer);
  renderHistory();
});

window.aimini.onStreamDone((item) => {
  streaming = false;
  upsertHistoryItem(item);
  showPreview(item.answer || "");
  hidePreviewSoon();
  resetIdleTimer();
});

window.aimini.onStreamError(({ item }) => {
  streaming = false;
  upsertHistoryItem(item);
  showPreview(item.answer || "");
  hidePreviewSoon();
  resetIdleTimer();
});

refreshHistory().then(resetIdleTimer);
