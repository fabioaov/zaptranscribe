"use strict";
(() => {
  // extension/src/utils/storageKeys.ts
  var STORAGE_API_KEY = "zap_openrouter_api_key";
  var STORAGE_MODELS = "zap_transcription_models";
  var STORAGE_LANGUAGE = "zap_transcription_language";
  var STORAGE_CACHE_TTL_MS = "zap_cache_ttl_ms";
  var DEFAULT_MODEL_LINES = [
    "openai/gpt-4o-audio-preview",
    "openai/gpt-audio-mini",
    "google/gemini-2.0-flash-001"
  ];
  var DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;

  // extension/src/options.ts
  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }
  function setText(id, messageKey) {
    const el = document.getElementById(id);
    if (el) el.textContent = t(messageKey);
  }
  async function load() {
    const { [STORAGE_API_KEY]: key, [STORAGE_MODELS]: models, [STORAGE_LANGUAGE]: lang } = await chrome.storage.local.get([STORAGE_API_KEY, STORAGE_MODELS, STORAGE_LANGUAGE]);
    const apiInput = document.getElementById("apiKey");
    const modelsInput = document.getElementById("models");
    const langInput = document.getElementById("language");
    if (apiInput && typeof key === "string") apiInput.value = key;
    if (modelsInput) {
      if (typeof models === "string" && models.trim()) {
        try {
          const parsed = JSON.parse(models);
          if (Array.isArray(parsed)) {
            modelsInput.value = parsed.filter((x) => typeof x === "string").join("\n");
          } else {
            modelsInput.value = models;
          }
        } catch {
          modelsInput.value = models;
        }
      } else {
        modelsInput.value = DEFAULT_MODEL_LINES.join("\n");
      }
    }
    if (langInput && typeof lang === "string") langInput.value = lang;
  }
  async function save() {
    const status = document.getElementById("status");
    const apiInput = document.getElementById("apiKey");
    const modelsInput = document.getElementById("models");
    const langInput = document.getElementById("language");
    const apiKey = apiInput?.value ?? "";
    const modelsLines = modelsInput?.value.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
    await chrome.storage.local.set({
      [STORAGE_API_KEY]: apiKey.trim(),
      [STORAGE_MODELS]: JSON.stringify(modelsLines.length ? modelsLines : DEFAULT_MODEL_LINES),
      [STORAGE_LANGUAGE]: (langInput?.value ?? "").trim(),
      [STORAGE_CACHE_TTL_MS]: String(DEFAULT_CACHE_TTL_MS)
    });
    if (status) status.textContent = t("saved");
  }
  function init() {
    setText("heading", "optionsHeading");
    setText("intro", "optionsIntro");
    setText("apiKeyLabel", "apiKeyLabel");
    setText("modelsLabel", "modelsLabel");
    setText("modelsHint", "modelsHint");
    setText("languageLabel", "languageLabel");
    setText("languageHint", "languageHint");
    const saveBtn = document.getElementById("save");
    if (saveBtn) saveBtn.textContent = t("save");
    void load();
    saveBtn?.addEventListener("click", () => void save());
  }
  init();
})();
