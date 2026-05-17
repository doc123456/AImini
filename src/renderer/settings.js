const fields = {
  provider: document.getElementById("provider"),
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  apiModel: document.getElementById("apiModel"),
  lmBaseUrl: document.getElementById("lmBaseUrl"),
  lmApiKey: document.getElementById("lmApiKey"),
  lmModel: document.getElementById("lmModel"),
  localBaseUrl: document.getElementById("localBaseUrl"),
  localApiKey: document.getElementById("localApiKey"),
  localModel: document.getElementById("localModel"),
  localModelPath: document.getElementById("localModelPath"),
  localBackend: document.getElementById("localBackend"),
  localCommand: document.getElementById("localCommand"),
  contextSize: document.getElementById("contextSize"),
  gpuLayers: document.getElementById("gpuLayers"),
  threads: document.getElementById("threads"),
  temperature: document.getElementById("temperature"),
  useGpu: document.getElementById("useGpu"),
  offloadKqv: document.getElementById("offloadKqv"),
  thinkingMode: document.getElementById("thinkingMode"),
  streamMode: document.getElementById("streamMode")
};

const saveButton = document.getElementById("save");
const status = document.getElementById("status");

function setForm(config) {
  fields.provider.value = config.provider;
  fields.apiBaseUrl.value = config.api.baseUrl;
  fields.apiKey.value = config.api.apiKey;
  fields.apiModel.value = config.api.model;
  fields.lmBaseUrl.value = config.lmStudio.baseUrl;
  fields.lmApiKey.value = config.lmStudio.apiKey;
  fields.lmModel.value = config.lmStudio.model;
  fields.localBaseUrl.value = config.local.baseUrl;
  fields.localApiKey.value = config.local.apiKey;
  fields.localModel.value = config.local.model;
  fields.localModelPath.value = config.local.modelPath;
  fields.localBackend.value = config.local.backend;
  fields.localCommand.value = config.local.command;
  fields.contextSize.value = config.local.contextSize;
  fields.gpuLayers.value = config.local.gpuLayers;
  fields.threads.value = config.local.threads;
  fields.temperature.value = config.local.temperature;
  fields.useGpu.checked = config.local.useGpu;
  fields.offloadKqv.checked = config.local.offloadKqv;
  fields.thinkingMode.checked = config.behavior?.thinkingMode !== false;
  fields.streamMode.checked = config.behavior?.stream !== false;
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
      baseUrl: fields.localBaseUrl.value.trim(),
      apiKey: fields.localApiKey.value.trim(),
      model: fields.localModel.value.trim(),
      modelPath: fields.localModelPath.value.trim(),
      backend: fields.localBackend.value.trim(),
      command: fields.localCommand.value.trim(),
      useGpu: fields.useGpu.checked,
      contextSize: Number(fields.contextSize.value || 4096),
      gpuLayers: Number(fields.gpuLayers.value || 0),
      offloadKqv: fields.offloadKqv.checked,
      threads: Number(fields.threads.value || 4),
      temperature: Number(fields.temperature.value || 0.7)
    },
    behavior: {
      thinkingMode: fields.thinkingMode.checked,
      stream: fields.streamMode.checked
    }
  };
}

saveButton.addEventListener("click", async () => {
  const saved = await window.aimini.saveSettings(getForm());
  setForm(saved);
  status.textContent = "已保存";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

window.aimini.getSettings().then(setForm);
