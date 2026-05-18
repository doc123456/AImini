const cacheList = document.getElementById("cacheList");
const refreshButton = document.getElementById("refreshCache");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trimStart();
}

function renderMarkdown(text) {
  return window.aimini.renderMarkdown(stripThinking(text));
}

function renderRecords(records) {
  if (!records.length) {
    cacheList.innerHTML = '<p class="cache-empty">暂无缓存记录</p>';
    return;
  }

  cacheList.innerHTML = records.map((record) => `
    <article class="cache-record">
      <div class="cache-time">${escapeHtml(record.createdAt)}</div>
      <div class="cache-prompt">${escapeHtml(record.prompt || "请分析这些截图。")}</div>
      ${(record.screenshots || []).length ? `
        <div class="cache-shots">
          ${record.screenshots.map((shot) => shot.dataUrl ? `
            <a href="${escapeHtml(shot.dataUrl)}" target="_blank" title="${escapeHtml(shot.filePath)}">
              <img src="${escapeHtml(shot.dataUrl)}" alt="cached screenshot" />
            </a>
          ` : "").join("")}
        </div>
      ` : ""}
      <div class="cache-answer markdown-body">${renderMarkdown(record.answer || "")}</div>
    </article>
  `).join("");
}

async function refreshCache() {
  const records = await window.aimini.getCacheRecords();
  renderRecords(records);
}

refreshButton.addEventListener("click", refreshCache);
refreshCache();
