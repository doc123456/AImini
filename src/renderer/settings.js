const fields = {
  provider: document.getElementById("provider"),
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  apiModel: document.getElementById("apiModel"),
  lmBaseUrl: document.getElementById("lmBaseUrl"),
  lmApiKey: document.getElementById("lmApiKey"),
  lmModel: document.getElementById("lmModel"),
  localModelPath: document.getElementById("localModelPath"),
  localMmprojPath: document.getElementById("localMmprojPath"),
  contextSize: document.getElementById("contextSize"),
  threads: document.getElementById("threads"),
  temperature: document.getElementById("temperature"),
  thinkingMode: document.getElementById("thinkingMode"),
  streamMode: document.getElementById("streamMode"),
  cacheDirectory: document.getElementById("cacheDirectory"),
  cacheCleanupStrategy: document.getElementById("cacheCleanupStrategy"),
  cacheMaxSizeMb: document.getElementById("cacheMaxSizeMb"),
  cacheMaxAgeDays: document.getElementById("cacheMaxAgeDays")
};

const saveButton = document.getElementById("save");
const chooseLocalModelButton = document.getElementById("chooseLocalModel");
const chooseLocalMmprojButton = document.getElementById("chooseLocalMmproj");
const clearLocalMmprojButton = document.getElementById("clearLocalMmproj");
const loadLocalModelButton = document.getElementById("loadLocalModel");
const stopLocalModelButton = document.getElementById("stopLocalModel");
const localLoadStatus = document.getElementById("localLoadStatus");
const localLoadLog = document.getElementById("localLoadLog");
const chooseCacheDirectoryButton = document.getElementById("chooseCacheDirectory");
const openCacheDirectoryButton = document.getElementById("openCacheDirectory");
const clearCacheButton = document.getElementById("clearCache");
const cacheDefaultPath = document.getElementById("cacheDefaultPath");
const status = document.getElementById("status");
let currentConfig;

function renderLocalLoadState(state = {}) {
  const statusText = state.message || "未加载模型";
  localLoadStatus.textContent = statusText;
  localLoadStatus.dataset.status = state.status || "idle";
  loadLocalModelButton.disabled = state.status === "loading";
  stopLocalModelButton.disabled = state.status !== "loading" && state.status !== "ready";
  loadLocalModelButton.textContent = state.status === "loading" ? "加载中..." : "加载模型";
  localLoadLog.textContent = (state.logs || []).slice(-80).join("\n");
  localLoadLog.scrollTop = localLoadLog.scrollHeight;
}

document.querySelectorAll(".settings-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll(".settings-tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
    });
    document.querySelectorAll(".settings-section").forEach((section) => {
      section.classList.toggle("active", section.dataset.section === tabName);
    });
  });
});

function setForm(config) {
  currentConfig = config;
  fields.provider.value = config.provider;
  fields.apiBaseUrl.value = config.api.baseUrl;
  fields.apiKey.value = config.api.apiKey;
  fields.apiModel.value = config.api.model;
  fields.lmBaseUrl.value = config.lmStudio.baseUrl;
  fields.lmApiKey.value = config.lmStudio.apiKey;
  fields.lmModel.value = config.lmStudio.model;
  fields.localModelPath.value = config.local.modelPath;
  fields.localMmprojPath.value = config.local.mmprojPath || "";
  fields.contextSize.value = config.local.contextSize;
  fields.threads.value = config.local.threads;
  fields.temperature.value = config.local.temperature;
  fields.thinkingMode.checked = config.behavior?.thinkingMode !== false;
  fields.streamMode.checked = config.behavior?.stream !== false;
  fields.cacheDirectory.value = config.cache?.directory || "";
  fields.cacheDirectory.placeholder = config.cache?.defaultDirectory || "";
  cacheDefaultPath.textContent = `默认位置：${config.cache?.defaultDirectory || ""}`;
  fields.cacheCleanupStrategy.value = config.cache?.cleanupStrategy || "size";
  fields.cacheMaxSizeMb.value = config.cache?.maxSizeMb || 500;
  fields.cacheMaxAgeDays.value = config.cache?.maxAgeDays || 30;
}

function getForm() {
  return {
    provider: fields.provider.value,
    api: {
      baseUrl: fields.apiBaseUrl.value.trim(),
      apiKey: fields.apiKey.value.trim(),
      model: fields.apiModel.value.trim()
    },
    lmStudio: {
      baseUrl: fields.lmBaseUrl.value.trim(),
      apiKey: fields.lmApiKey.value.trim(),
      model: fields.lmModel.value.trim()
    },
    local: {
      enabled: fields.provider.value === "local",
      baseUrl: "http://localhost:8080/v1",
      apiKey: "local",
      model: "",
      modelPath: fields.localModelPath.value.trim(),
      mmprojPath: fields.localMmprojPath.value.trim(),
      backend: "内置 llama.cpp CPU",
      command: "",
      useGpu: false,
      contextSize: Number(fields.contextSize.value || 4096),
      gpuLayers: 0,
      offloadKqv: false,
      threads: Number(fields.threads.value || 4),
      temperature: Number(fields.temperature.value || 0.7)
    },
    behavior: {
      thinkingMode: fields.thinkingMode.checked,
      stream: fields.streamMode.checked
    },
    cache: {
      directory: fields.cacheDirectory.value.trim(),
      cleanupStrategy: fields.cacheCleanupStrategy.value,
      maxSizeMb: Number(fields.cacheMaxSizeMb.value || 500),
      maxAgeDays: Number(fields.cacheMaxAgeDays.value || 30)
    }
  };
}

chooseLocalModelButton.addEventListener("click", async () => {
  const modelPath = await window.aimini.selectLocalModel();
  if (modelPath) fields.localModelPath.value = modelPath;
});

chooseLocalMmprojButton.addEventListener("click", async () => {
  const mmprojPath = await window.aimini.selectLocalMmproj();
  if (mmprojPath) fields.localMmprojPath.value = mmprojPath;
});

clearLocalMmprojButton.addEventListener("click", () => {
  fields.localMmprojPath.value = "";
});

loadLocalModelButton.addEventListener("click", async () => {
  try {
    const saved = await window.aimini.saveSettings(getForm());
    setForm(saved);
    renderLocalLoadState({ status: "loading", message: "正在准备加载模型...", logs: [] });
    const state = await window.aimini.loadLocalModel(saved);
    renderLocalLoadState(state);
  } catch (error) {
    renderLocalLoadState({
      status: "error",
      message: error.message || "模型加载失败",
      logs: [error.stack || error.message || String(error)]
    });
  }
});

stopLocalModelButton.addEventListener("click", async () => {
  const state = await window.aimini.stopLocalModel();
  renderLocalLoadState(state);
});

chooseCacheDirectoryButton.addEventListener("click", async () => {
  const directory = await window.aimini.selectCacheDirectory();
  if (directory) fields.cacheDirectory.value = directory;
});

openCacheDirectoryButton.addEventListener("click", async () => {
  try {
    await window.aimini.openCacheDirectory();
    status.textContent = "已打开缓存文件夹";
  } catch (error) {
    status.textContent = error.message || "打开失败";
  }
  setTimeout(() => { status.textContent = ""; }, 1800);
});

clearCacheButton.addEventListener("click", async () => {
  const cleared = await window.aimini.clearCacheRecords();
  status.textContent = cleared ? "缓存记录已清空" : "已取消清空";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

saveButton.addEventListener("click", async () => {
  const saved = await window.aimini.saveSettings(getForm());
  setForm(saved);
  status.textContent = "已保存";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

window.aimini.getSettings().then(setForm);
window.aimini.getLocalLoadStatus().then(renderLocalLoadState);
window.aimini.onLocalLoadStatus(renderLocalLoadState);
