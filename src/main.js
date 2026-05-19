const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, nativeImage, screen, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let floatingWindow;
let settingsWindow;
let cacheWindow;
let imagePreviewWindow;
let tray;
let configPath;
let cacheDir;
let recordsPath;
let screenshotsDir;
let localProcess;
let localRuntimeState = {
  status: "idle",
  message: "未加载模型",
  ready: false,
  logs: []
};
let captureWindow;
let captureSelectionResolver;
let capturePreviewDataUrl = "";
let startupCacheCleanupApplied = false;

const FLOATING_SIZES = {
  collapsed: { width: 42, height: 42 },
  normal: { width: 600, height: 62 },
  preview: { width: 600, height: 151 },
  history: { width: 600, height: 399 }
};

function setFloatingSize(size) {
  if (!floatingWindow) return;
  const bounds = floatingWindow.getBounds();
  const nextX = bounds.x + bounds.width - size.width;
  floatingWindow.setBounds({ x: nextX, y: bounds.y, width: size.width, height: size.height }, false);
}

const trayIconDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR4nGNgoDYQ66r6jw9TpBmvIcRqxmoIuiQugNMQYjRjM2TUAFoZQFY0UpyQqJKUiTUEr2ZyAAB3BtoQIxaBPgAAAABJRU5ErkJggg==";

const defaultConfig = {
  provider: "lmstudio",
  api: {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: ""
  },
  lmStudio: {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "lm-studio",
    model: ""
  },
  local: {
    enabled: false,
    baseUrl: "http://localhost:8080/v1",
    apiKey: "local",
    model: "",
    modelPath: "",
    mmprojPath: "",
    backend: "内置 llama.cpp CPU",
    useGpu: false,
    contextSize: 4096,
    gpuLayers: 0,
    offloadKqv: false,
    threads: 8,
    temperature: 0.7,
    command: ""
  },
  behavior: {
    thinkingMode: true,
    stream: true
  },
  cache: {
    directory: "",
    cleanupStrategy: "size",
    maxSizeMb: 500,
    maxAgeDays: 30
  }
};

const history = [];
const CONTEXT_TURNS = 8;
const CACHE_LIMIT = 500;

app.commandLine.appendSwitch("disable-direct-composition");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,OverlayScrollbar,UseSkiaRenderer");

function getAppIcon() {
  return nativeImage.createFromDataURL(trayIconDataUrl);
}

function getDefaultCacheDir() {
  return path.join(app.getPath("userData"), "AIminiRecords");
}

function ensureConfig() {
  configPath = path.join(app.getPath("userData"), "settings.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return structuredClone(defaultConfig);
  }

  try {
    return mergeConfig(defaultConfig, JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    return structuredClone(defaultConfig);
  }
}

function ensureCache() {
  const config = ensureConfig();
  cacheDir = config.cache?.directory || getDefaultCacheDir();
  screenshotsDir = path.join(cacheDir, "screenshots");
  recordsPath = path.join(cacheDir, "records.json");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  if (!fs.existsSync(recordsPath)) {
    fs.writeFileSync(recordsPath, "[]");
  }
}

function getLegacyCacheDir() {
  return path.join(app.getPath("userData"), "cache");
}

function migrateLegacyCacheIfNeeded() {
  const config = ensureConfig();
  if (config.cache?.directory) return;

  const legacyDir = getLegacyCacheDir();
  const legacyRecords = path.join(legacyDir, "records.json");
  const newRecords = path.join(getDefaultCacheDir(), "records.json");
  if (!fs.existsSync(legacyRecords) || fs.existsSync(newRecords)) return;

  try {
    const newDir = getDefaultCacheDir();
    fs.mkdirSync(path.join(newDir, "screenshots"), { recursive: true });
    fs.copyFileSync(legacyRecords, newRecords);
    const legacyScreenshots = path.join(legacyDir, "screenshots");
    if (fs.existsSync(legacyScreenshots)) {
      fs.cpSync(legacyScreenshots, path.join(newDir, "screenshots"), { recursive: true, force: false });
    }
  } catch {
    // Keep running even if migration fails.
  }
}

function safeDeleteFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best effort cleanup.
  }
}

function clearCacheFiles() {
  ensureCache();
  const records = readCacheRecords();
  for (const record of records) {
    for (const screenshot of record.screenshots || []) {
      safeDeleteFile(screenshot);
    }
  }
  writeCacheRecords([]);
}

function getRecordTime(record) {
  if (Number.isFinite(record.createdAtMs)) return record.createdAtMs;
  const idTime = Number(record.id);
  if (Number.isFinite(idTime)) return idTime;
  const parsed = Date.parse(record.createdAt || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function getRecordSize(record) {
  let total = Buffer.byteLength(JSON.stringify(record), "utf8");
  for (const screenshot of record.screenshots || []) {
    try {
      total += fs.statSync(screenshot).size;
    } catch {
      // Ignore missing files.
    }
  }
  return total;
}

function cleanupCache(isStartup = false) {
  ensureCache();
  const config = ensureConfig();
  const strategy = config.cache?.cleanupStrategy || "size";
  const maxAgeDays = Math.max(1, Number(config.cache?.maxAgeDays || 30));
  const maxSizeBytes = Math.max(1, Number(config.cache?.maxSizeMb || 500)) * 1024 * 1024;
  let records = readCacheRecords();
  const removed = [];

  if (strategy === "startup" && isStartup && !startupCacheCleanupApplied) {
    startupCacheCleanupApplied = true;
    clearCacheFiles();
    return;
  }

  if (strategy === "startup") {
    return;
  }

  if (strategy === "age") {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const kept = [];
    for (const record of records) {
      if (getRecordTime(record) < cutoff) removed.push(record);
      else kept.push(record);
    }
    records = kept;
  }

  if (strategy === "size") {
    let used = 0;
    const kept = [];
    const sorted = [...records].sort((a, b) => getRecordTime(b) - getRecordTime(a));
    for (const record of sorted) {
      const size = getRecordSize(record);
      if (used + size <= maxSizeBytes) {
        used += size;
        kept.push(record);
      } else {
        removed.push(record);
      }
    }
    records = kept;
  }

  for (const record of removed) {
    for (const screenshot of record.screenshots || []) {
      safeDeleteFile(screenshot);
    }
  }
  writeCacheRecords(records);
}

function readCacheRecords() {
  ensureCache();
  try {
    const records = JSON.parse(fs.readFileSync(recordsPath, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeCacheRecords(records) {
  ensureCache();
  fs.writeFileSync(recordsPath, JSON.stringify(records.slice(0, CACHE_LIMIT), null, 2));
}

function saveScreenshotFiles(recordId, screenshots) {
  ensureCache();
  return (Array.isArray(screenshots) ? screenshots : [])
    .filter(Boolean)
    .map((base64, index) => {
      const filename = `${recordId}-${index + 1}.png`;
      const filePath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
      return filePath;
    });
}

function cacheConversation(item, screenshots) {
  ensureCache();
  const recordId = String(item.id || Date.now());
  const screenshotPaths = saveScreenshotFiles(recordId, screenshots);
  const records = readCacheRecords().filter((record) => String(record.id) !== recordId);
  records.unshift({
    id: recordId,
    prompt: item.prompt || "",
    answer: item.answer || "",
    createdAt: item.createdAt || new Date().toLocaleString(),
    createdAtMs: Number(item.id) || Date.now(),
    screenshotCount: screenshotPaths.length,
    screenshots: screenshotPaths
  });
  writeCacheRecords(records);
  cleanupCache(false);
}

function imageFileToDataUrl(filePath) {
  try {
    const data = fs.readFileSync(filePath).toString("base64");
    return `data:image/png;base64,${data}`;
  } catch {
    return "";
  }
}

function getCacheForView() {
  return readCacheRecords().map((record) => ({
    ...record,
    screenshots: (record.screenshots || []).map((filePath) => ({
      filePath,
      dataUrl: imageFileToDataUrl(filePath)
    }))
  }));
}

let previewImageData = { dataUrl: "", filePath: "" };

function openImagePreview(filePath) {
  const recordsRoot = path.resolve(screenshotsDir || path.join(app.getPath("userData"), "cache", "screenshots"));
  const resolvedPath = path.resolve(filePath || "");
  if (!resolvedPath.startsWith(recordsRoot) || !fs.existsSync(resolvedPath)) {
    throw new Error("图片文件不存在或路径无效。");
  }

  previewImageData = {
    dataUrl: imageFileToDataUrl(resolvedPath),
    filePath: resolvedPath
  };

  if (imagePreviewWindow && !imagePreviewWindow.isDestroyed()) {
    imagePreviewWindow.focus();
    imagePreviewWindow.webContents.send("image-preview:updated", previewImageData);
    return;
  }

  imagePreviewWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 520,
    minHeight: 420,
    title: "AImini 截图预览",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  imagePreviewWindow.loadFile(path.join(__dirname, "renderer", "image-preview.html"));
}

function mergeConfig(base, incoming) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      output[key] = mergeConfig(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(mergeConfig(defaultConfig, config), null, 2));
  ensureCache();
  cleanupCache(false);
}

function getConfigForView() {
  const config = ensureConfig();
  return mergeConfig(config, {
    cache: {
      defaultDirectory: getDefaultCacheDir()
    }
  });
}

function createFloatingWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const { width, height } = FLOATING_SIZES.normal;

  floatingWindow = new BrowserWindow({
    width,
    height,
    minWidth: 460,
    minHeight: 62,
    x: display.x + display.width - width - 24,
    y: display.y + 24,
    frame: false,
    transparent: false,
    backgroundColor: "#FAFCFF",
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  floatingWindow.setAlwaysOnTop(true, "screen-saver");
  floatingWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  floatingWindow.once("ready-to-show", () => floatingWindow.show());
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: "AImini 设置",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
}

function createCacheWindow() {
  if (cacheWindow && !cacheWindow.isDestroyed()) {
    cacheWindow.focus();
    return;
  }

  cacheWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    title: "AImini 缓存记录",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  cacheWindow.loadFile(path.join(__dirname, "renderer", "cache.html"));
}

function createTray() {
  tray = new Tray(getAppIcon());
  tray.setToolTip("AImini");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示悬浮窗", click: () => floatingWindow?.show() },
    { label: "隐藏悬浮窗", click: () => floatingWindow?.hide() },
    { type: "separator" },
    { label: "查看缓存记录", click: createCacheWindow },
    { label: "设置", click: createSettingsWindow },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]));
}

async function capturePrimaryScreen() {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: display.size
  });
  const source = sources[0];
  if (!source) {
    throw new Error("没有找到可截图的屏幕。");
  }
  return source.thumbnail.toPNG().toString("base64");
}

function requestCaptureSelection(display, previewDataUrl) {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  capturePreviewDataUrl = previewDataUrl;

  const bounds = display.bounds;
  captureWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: "#FAFCFF",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  captureWindow.setAlwaysOnTop(true, "screen-saver");
  captureWindow.loadFile(path.join(__dirname, "renderer", "capture.html"));
  captureWindow.on("closed", () => {
    captureWindow = null;
    capturePreviewDataUrl = "";
    if (captureSelectionResolver) {
      captureSelectionResolver(null);
      captureSelectionResolver = null;
    }
  });

  return new Promise((resolve) => {
    captureSelectionResolver = resolve;
  });
}

async function captureSelectedScreenRegion() {
  const display = screen.getPrimaryDisplay();
  const wasVisible = floatingWindow?.isVisible();
  if (wasVisible) {
    floatingWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 140));
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: display.size
  });
  const source = sources[0];
  if (!source) {
    if (wasVisible) floatingWindow?.show();
    throw new Error("没有找到可截图的屏幕。");
  }

  const image = source.thumbnail;
  const rect = await requestCaptureSelection(display, image.toDataURL());
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  if (wasVisible) floatingWindow?.show();

  if (!rect) {
    throw new Error("已取消截图。");
  }

  const imageSize = image.getSize();
  const scaleX = imageSize.width / display.bounds.width;
  const scaleY = imageSize.height / display.bounds.height;
  const cropRect = {
    x: Math.max(0, Math.round(rect.x * scaleX)),
    y: Math.max(0, Math.round(rect.y * scaleY)),
    width: Math.max(1, Math.round(rect.width * scaleX)),
    height: Math.max(1, Math.round(rect.height * scaleY))
  };
  return image.crop(cropRect).toPNG().toString("base64");
}

function resolveEndpoint(config) {
  if (config.provider === "local") {
    return {
      baseUrl: config.local.baseUrl || "http://localhost:8080/v1",
      apiKey: config.local.apiKey || "local",
      model: getLocalModelAlias(config)
    };
  }

  if (config.provider === "lmstudio") {
    return {
      baseUrl: config.lmStudio.baseUrl || "http://localhost:1234/v1",
      apiKey: config.lmStudio.apiKey || "lm-studio",
      model: config.lmStudio.model
    };
  }

  if (config.provider === "api") {
    return config.api;
  }

  return null;
}

function getBundledLlamaRuntimeDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "llama.cpp", "cpu");
  }
  return path.join(app.getAppPath(), "resources", "llama.cpp", "cpu");
}

function getBundledLlamaServerPath() {
  return path.join(getBundledLlamaRuntimeDir(), "llama-server.exe");
}

function getEndpointUrl(baseUrl) {
  try {
    return new URL(baseUrl || "http://localhost:8080/v1");
  } catch {
    return new URL("http://localhost:8080/v1");
  }
}

function getLocalServerOptions(config) {
  const endpointUrl = getEndpointUrl(config.local.baseUrl);
  const port = Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80));
  const hostname = endpointUrl.hostname || "127.0.0.1";
  return {
    host: hostname === "localhost" ? "127.0.0.1" : hostname,
    port: Number.isFinite(port) ? port : 8080
  };
}

function getLocalModelAlias(config) {
  if (config.local.model) return config.local.model;
  if (config.local.modelPath) {
    return path.basename(config.local.modelPath, path.extname(config.local.modelPath));
  }
  return "local-model";
}

function isAscii(value) {
  return /^[\x00-\x7F]*$/.test(String(value || ""));
}

function getModelLinkRoot() {
  return path.join(app.getPath("userData"), "ModelLinks");
}

function getRuntimeSafeModelPath(modelPath) {
  const resolvedModelPath = path.resolve(modelPath);
  if (isAscii(resolvedModelPath)) {
    return resolvedModelPath;
  }

  const filename = path.basename(resolvedModelPath);
  if (!isAscii(filename)) {
    throw new Error("模型文件名包含中文或特殊字符，请先把 GGUF 文件名改成英文后再加载。");
  }

  const modelDir = path.dirname(resolvedModelPath);
  const linkRoot = getModelLinkRoot();
  const linkName = crypto.createHash("sha1").update(modelDir).digest("hex").slice(0, 12);
  const linkDir = path.join(linkRoot, linkName);

  fs.mkdirSync(linkRoot, { recursive: true });
  if (!fs.existsSync(linkDir)) {
    fs.symlinkSync(modelDir, linkDir, "junction");
  }

  const linkedModelPath = path.join(linkDir, filename);
  if (!fs.existsSync(linkedModelPath)) {
    throw new Error(`无法为中文模型目录创建可加载路径，请把模型移动到纯英文目录后重试：${modelDir}`);
  }

  return linkedModelPath;
}

function getRuntimeSafeOptionalFilePath(filePath, label) {
  if (!filePath) return "";
  const resolvedFilePath = path.resolve(filePath);
  if (!fs.existsSync(resolvedFilePath)) {
    throw new Error(`${label}文件不存在：${filePath}`);
  }
  return getRuntimeSafeModelPath(resolvedFilePath);
}

function buildBundledLlamaArgs(config) {
  if (!config.local.modelPath) {
    throw new Error("请先在设置中选择本地 GGUF 模型路径。");
  }

  if (!fs.existsSync(config.local.modelPath)) {
    throw new Error(`模型文件不存在：${config.local.modelPath}`);
  }

  const serverPath = getBundledLlamaServerPath();
  if (!fs.existsSync(serverPath)) {
    throw new Error(`内置 llama-server 不存在：${serverPath}`);
  }

  const { host, port } = getLocalServerOptions(config);
  const modelPath = getRuntimeSafeModelPath(config.local.modelPath);
  const mmprojPath = getRuntimeSafeOptionalFilePath(config.local.mmprojPath, "视觉投影");
  const args = [
    "--host", host,
    "--port", String(port),
    "--model", modelPath,
    "--alias", getLocalModelAlias(config),
    "--no-ui",
    "--parallel", "1",
    "--no-cont-batching"
  ];

  if (mmprojPath) {
    args.push("--mmproj", mmprojPath);
  }

  const contextSize = Number(config.local.contextSize);
  if (Number.isFinite(contextSize) && contextSize > 0) {
    args.push("--ctx-size", String(contextSize));
  }

  const threads = Number(config.local.threads);
  if (Number.isFinite(threads) && threads > 0) {
    args.push("--threads", String(threads));
    args.push("--threads-batch", String(threads));
  }

  if (config.local.apiKey) {
    args.push("--api-key", config.local.apiKey);
  }

  return { serverPath, args };
}

function getLocalRuntimeState() {
  return {
    ...localRuntimeState,
    logs: [...localRuntimeState.logs]
  };
}

function emitLocalRuntimeState(patch = {}) {
  localRuntimeState = {
    ...localRuntimeState,
    ...patch,
    updatedAt: Date.now()
  };
  settingsWindow?.webContents.send("local:load-status", getLocalRuntimeState());
  return getLocalRuntimeState();
}

function appendLocalRuntimeLog(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return;

  const logs = [...localRuntimeState.logs, ...lines].slice(-160);
  const lastLine = lines[lines.length - 1];
  emitLocalRuntimeState({
    logs,
    status: localRuntimeState.ready ? "ready" : "loading",
    message: lastLine
  });
}

async function waitForLocalRuntime(baseUrl, apiKey) {
  const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (!localProcess) {
      throw new Error("llama-server 已退出，请查看加载日志。");
    }

    try {
      const response = await fetch(modelsUrl, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
      });
      if (response.ok) {
        emitLocalRuntimeState({
          status: "ready",
          message: "模型已加载，服务已就绪",
          ready: true
        });
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message || String(error);
    }

    emitLocalRuntimeState({
      status: "loading",
      message: `正在等待本地服务启动：${lastError}`,
      ready: false
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`本地 llama-server 启动超时：${lastError}`);
}

async function startLocalRuntime(config, { force = false } = {}) {
  if (config.provider !== "local") {
    throw new Error("请先把 AI 来源切换为内置模型加载器。");
  }

  if (localProcess && localRuntimeState.ready && !force) {
    return getLocalRuntimeState();
  }

  if (localProcess && !force) {
    await waitForLocalRuntime(config.local.baseUrl || "http://localhost:8080/v1", config.local.apiKey);
    return getLocalRuntimeState();
  }

  if (localProcess && force) {
    localProcess.removeAllListeners("exit");
    localProcess.kill();
    localProcess = null;
  }

  const { serverPath, args } = buildBundledLlamaArgs(config);
  const safeModelPath = args[args.indexOf("--model") + 1];
  const mmprojIndex = args.indexOf("--mmproj");
  const safeMmprojPath = mmprojIndex >= 0 ? args[mmprojIndex + 1] : "";
  emitLocalRuntimeState({
    status: "loading",
    message: "正在启动内置 llama-server...",
    ready: false,
    logs: [
      config.local.modelPath !== safeModelPath
        ? `模型路径包含非英文字符，已转换为运行时路径：${safeModelPath}`
        : `模型路径：${safeModelPath}`,
      safeMmprojPath
        ? `视觉投影文件：${safeMmprojPath}`
        : "未配置视觉投影文件，截图输入将不可用。",
      `${serverPath} ${args.join(" ")}`
    ]
  });

  localProcess = spawn(serverPath, args, {
    shell: false,
    cwd: getBundledLlamaRuntimeDir(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  localProcess.stdout?.on("data", (data) => appendLocalRuntimeLog(data.toString("utf8")));
  localProcess.stderr?.on("data", (data) => appendLocalRuntimeLog(data.toString("utf8")));

  localProcess.once("exit", () => {
    localProcess = null;
    emitLocalRuntimeState({
      status: "error",
      message: localRuntimeState.ready ? "llama-server 已退出" : "llama-server 已退出，模型没有加载成功",
      ready: false
    });
  });

  await waitForLocalRuntime(config.local.baseUrl || "http://localhost:8080/v1", config.local.apiKey);
  return getLocalRuntimeState();
}

async function ensureLocalRuntime(config) {
  if (config.provider !== "local") {
    return;
  }
  await startLocalRuntime(config, { force: false });
}

function createUserContent({ prompt, screenshots, config }) {
  const imageList = Array.isArray(screenshots) ? screenshots.filter(Boolean) : [];
  let userText = prompt || (imageList.length ? "请分析这些截图。" : "");
  if (config.behavior?.thinkingMode === false) {
    userText = `${userText}\n\n/no_think`.trim();
  }

  if (!userText && !imageList.length) {
    throw new Error("请输入文字，或先添加一张截图。");
  }

  const content = imageList.length
    ? [
        { type: "text", text: userText },
        ...imageList.map((screenshotBase64) => ({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`
          }
        }))
      ]
    : userText;

  return { content, imageList };
}

function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

function buildConversationMessages(currentContent) {
  const priorMessages = [];
  const completedItems = history
    .filter((item) => item.prompt && item.answer)
    .slice(0, CONTEXT_TURNS)
    .reverse();

  for (const item of completedItems) {
    const promptText = item.hasScreenshot
      ? `${item.prompt}\n[用户在这一轮附加了 ${item.screenshotCount || 1} 张截图，旧截图不再重复发送。]`
      : item.prompt;
    priorMessages.push({ role: "user", content: promptText });
    priorMessages.push({ role: "assistant", content: stripThinking(item.answer) });
  }

  priorMessages.push({ role: "user", content: currentContent });
  return priorMessages;
}

function getDeltaFromChunk(chunk) {
  const lines = chunk.split(/\r?\n/);
  let output = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      output += parsed.choices?.[0]?.delta?.content || "";
    } catch {
      // Some local servers may emit keep-alive text; ignore non-JSON chunks.
    }
  }
  return output;
}

async function requestModel({ prompt, screenshots, stream, onDelta }) {
  const config = ensureConfig();
  await ensureLocalRuntime(config);
  const endpoint = resolveEndpoint(config);
  if (!endpoint?.baseUrl || !endpoint?.model) {
    throw new Error("请先在设置中填写 URL、API Key 和模型名称。");
  }

  const { content } = createUserContent({ prompt, screenshots, config });
  const baseUrl = endpoint.baseUrl.replace(/\/$/, "");
  const useStream = Boolean(stream && config.behavior?.stream !== false);
  const thinkingDisabled = config.behavior?.thinkingMode === false;
  const body = {
    model: endpoint.model,
    messages: buildConversationMessages(content),
    temperature: config.local.temperature ?? 0.7,
    stream: useStream
  };

  if (thinkingDisabled) {
    body.enable_thinking = false;
    body.enableThinking = false;
    body.thinking_budget = 0;
    body.chat_template_kwargs = { enable_thinking: false };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey || "not-needed"}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败：${response.status} ${text.slice(0, 240)}`);
  }

  if (useStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        const delta = getDeltaFromChunk(part);
        if (!delta) continue;
        answer += delta;
        onDelta?.(delta, answer);
      }
    }

    const tail = getDeltaFromChunk(buffer);
    if (tail) {
      answer += tail;
      onDelta?.(tail, answer);
    }
    return answer || "模型没有返回文本内容。";
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "模型没有返回文本内容。";
}

ipcMain.handle("settings:get", () => getConfigForView());
ipcMain.handle("settings:save", (_event, config) => {
  saveConfig(config);
  return getConfigForView();
});
ipcMain.handle("local:select-model", async () => {
  const result = await dialog.showOpenDialog(settingsWindow || floatingWindow, {
    title: "选择 GGUF 模型文件",
    properties: ["openFile"],
    filters: [
      { name: "GGUF 模型", extensions: ["gguf"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  return result.canceled ? "" : result.filePaths[0];
});
ipcMain.handle("local:select-mmproj", async () => {
  const result = await dialog.showOpenDialog(settingsWindow || floatingWindow, {
    title: "选择视觉投影 mmproj 文件",
    properties: ["openFile"],
    filters: [
      { name: "GGUF 视觉投影", extensions: ["gguf"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  return result.canceled ? "" : result.filePaths[0];
});
ipcMain.handle("local:get-load-status", () => getLocalRuntimeState());
ipcMain.handle("local:load-model", async (_event, config) => {
  const mergedConfig = mergeConfig(ensureConfig(), config || {});
  try {
    return await startLocalRuntime(mergedConfig, { force: true });
  } catch (error) {
    return emitLocalRuntimeState({
      status: "error",
      message: error.message || String(error),
      ready: false
    });
  }
});
ipcMain.handle("cache:select-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择缓存存放位置",
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? "" : result.filePaths[0];
});
ipcMain.handle("cache:open-directory", async () => {
  ensureCache();
  fs.mkdirSync(cacheDir, { recursive: true });
  const error = await shell.openPath(cacheDir);
  if (error) throw new Error(error);
  return cacheDir;
});
ipcMain.handle("cache:clear", async () => {
  const result = await dialog.showMessageBox(settingsWindow || cacheWindow || floatingWindow, {
    type: "warning",
    buttons: ["取消", "清空记录"],
    defaultId: 0,
    cancelId: 0,
    title: "清空缓存记录",
    message: "确定要清空所有缓存聊天记录和截图吗？",
    detail: "此操作只会删除 AImini 的 records.json 和 screenshots/ 中的截图，无法撤销。"
  });
  if (result.response !== 1) return false;
  clearCacheFiles();
  cacheWindow?.webContents.send("cache:updated");
  return true;
});

ipcMain.handle("history:get", () => history);
ipcMain.handle("cache:get", () => getCacheForView());
ipcMain.handle("cache:open-image", (_event, filePath) => openImagePreview(filePath));
ipcMain.handle("image-preview:get", () => previewImageData);
ipcMain.handle("window:set-expanded", (_event, expanded) => {
  const size = expanded ? FLOATING_SIZES.history : FLOATING_SIZES.normal;
  setFloatingSize(size);
});

ipcMain.handle("window:set-preview", (_event, visible) => {
  setFloatingSize(visible ? FLOATING_SIZES.preview : FLOATING_SIZES.normal);
});

ipcMain.handle("window:set-collapsed", (_event, collapsed) => {
  setFloatingSize(collapsed ? FLOATING_SIZES.collapsed : FLOATING_SIZES.normal);
});

ipcMain.handle("assistant:capture", () => captureSelectedScreenRegion());
ipcMain.handle("capture:get-preview", () => capturePreviewDataUrl);

ipcMain.on("capture:select", (_event, rect) => {
  if (captureSelectionResolver) {
    captureSelectionResolver(rect);
    captureSelectionResolver = null;
  }
});

ipcMain.on("capture:cancel", () => {
  if (captureSelectionResolver) {
    captureSelectionResolver(null);
    captureSelectionResolver = null;
  }
});

ipcMain.handle("assistant:ask", async (_event, message) => {
  const prompt = message?.prompt || "";
  const screenshots = Array.isArray(message?.screenshots)
    ? message.screenshots
    : (message?.screenshotBase64 ? [message.screenshotBase64] : []);
  const answer = await requestModel({ prompt, screenshots, stream: false });
  const item = {
    id: Date.now(),
    prompt: prompt || "请分析这些截图。",
    screenshotCount: screenshots.filter(Boolean).length,
    hasScreenshot: screenshots.some(Boolean),
    answer,
    createdAt: new Date().toLocaleString()
  };
  history.unshift(item);
  history.splice(20);
  cacheConversation(item, screenshots);
  floatingWindow?.webContents.send("history:updated", history);
  return item;
});

ipcMain.on("assistant:ask-stream", async (event, message) => {
  const requestId = message?.requestId || Date.now();
  const prompt = message?.prompt || "";
  const screenshots = Array.isArray(message?.screenshots)
    ? message.screenshots
    : (message?.screenshotBase64 ? [message.screenshotBase64] : []);
  const item = {
    id: requestId,
    prompt: prompt || "请分析这些截图。",
    screenshotCount: screenshots.filter(Boolean).length,
    hasScreenshot: screenshots.some(Boolean),
    answer: "",
    createdAt: new Date().toLocaleString()
  };

  history.unshift(item);
  history.splice(20);
  event.sender.send("assistant:stream-start", item);

  try {
    const answer = await requestModel({
      prompt,
      screenshots,
      stream: true,
      onDelta: (delta, fullText) => {
        item.answer = fullText;
        event.sender.send("assistant:stream-delta", { requestId, delta, answer: fullText });
      }
    });
    item.answer = answer;
    cacheConversation(item, screenshots);
    event.sender.send("assistant:stream-done", item);
  } catch (error) {
    item.answer = error.message || String(error);
    cacheConversation(item, screenshots);
    event.sender.send("assistant:stream-error", { requestId, message: item.answer, item });
  }
});

app.whenReady().then(() => {
  ensureConfig();
  migrateLegacyCacheIfNeeded();
  ensureCache();
  cleanupCache(true);
  createFloatingWindow();
  createTray();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  if (localProcess) {
    localProcess.kill();
    localProcess = null;
  }
});
