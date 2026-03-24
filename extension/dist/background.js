"use strict";
(() => {
  // extension/src/utils/mimeToOpenRouterAudioFormat.ts
  function mimeToOpenRouterAudioFormat(mimeType) {
    const m = mimeType.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
    const map = {
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/wave": "wav",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/ogg": "ogg",
      "audio/webm": "ogg",
      "audio/aac": "aac",
      "audio/mp4": "m4a",
      "audio/x-m4a": "m4a",
      "audio/flac": "flac",
      "audio/aiff": "aiff",
      "audio/x-aiff": "aiff"
    };
    if (map[m]) return map[m];
    if (m === "application/ogg") return "ogg";
    const ext = m.split("/")[1];
    if (ext && ["wav", "mp3", "ogg", "aac", "flac", "aiff", "m4a"].includes(ext)) {
      return ext;
    }
    return "ogg";
  }

  // extension/src/services/openrouter.ts
  var CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 32768;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }
  function buildUserText(languageHint) {
    const base = "Transcribe the speech in this audio accurately. If the language is ambiguous, transcribe in the original spoken language. Return only the transcript text, no preamble.";
    if (languageHint?.trim()) {
      return `${base} Prefer language/locale hint: ${languageHint.trim()}.`;
    }
    return base;
  }
  function parseErrorMessage(status, bodyText) {
    try {
      const j = JSON.parse(bodyText);
      const primary = j.error?.message ?? j.message ?? `HTTP ${status}`;
      const raw = j.error?.metadata?.raw;
      if (raw != null) {
        const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (rawStr.trim() && !primary.includes(rawStr.slice(0, 80))) {
          return `${primary} \u2014 ${rawStr.slice(0, 280)}`;
        }
      }
      return primary;
    } catch {
      return bodyText || `HTTP ${status}`;
    }
  }
  function extractAssistantText(data) {
    if (!data || typeof data !== "object") return null;
    const d = data;
    const content = d.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    return null;
  }
  async function postTranscription(apiKey, models, base64Audio, format, userText) {
    const body = {
      models,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format
              }
            }
          ]
        }
      ],
      stream: false
    };
    const run = async () => {
      const res = await fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/zaptranscribe",
          "X-OpenRouter-Title": "ZapTranscribe"
        },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(parseErrorMessage(res.status, text));
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON from OpenRouter");
      }
      const out = extractAssistantText(parsed);
      if (!out) throw new Error("Empty transcription from model");
      return { text: out };
    };
    try {
      return await run();
    } catch (e) {
      if (e instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 400));
        return run();
      }
      throw e;
    }
  }
  async function transcribeWithOpenRouter(params) {
    const { apiKey, models, arrayBuffer, mimeType, languageHint } = params;
    if (!models.length) throw new Error("No models configured");
    const format = mimeToOpenRouterAudioFormat(mimeType);
    const base64Audio = arrayBufferToBase64(arrayBuffer);
    const userText = buildUserText(languageHint);
    const { text } = await postTranscription(apiKey, models, base64Audio, format, userText);
    return text;
  }

  // extension/src/utils/base64Payload.ts
  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // extension/src/utils/hashBuffer.ts
  function tagOf(x) {
    return Object.prototype.toString.call(x);
  }
  function copyArrayBuffer(ab) {
    return new Uint8Array(ab).slice().buffer;
  }
  function normalizeToArrayBuffer(input) {
    if (input === null || input === void 0) {
      throw new Error("Audio bytes missing");
    }
    const tag = tagOf(input);
    if (input instanceof ArrayBuffer || tag === "[object ArrayBuffer]") {
      return copyArrayBuffer(input);
    }
    if (tag === "[object SharedArrayBuffer]") {
      const u = new Uint8Array(input);
      return u.slice().buffer;
    }
    if (ArrayBuffer.isView(input)) {
      const v = input;
      const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return u.slice().buffer;
    }
    if (typeof input === "object" && input !== null && "buffer" in input) {
      const v = input;
      const buf = v.buffer;
      const off = typeof v.byteOffset === "number" ? v.byteOffset : 0;
      const len = typeof v.byteLength === "number" ? v.byteLength : -1;
      if (len >= 0 && (buf instanceof ArrayBuffer || tagOf(buf) === "[object ArrayBuffer]")) {
        const u = new Uint8Array(buf, off, len);
        return u.slice().buffer;
      }
    }
    throw new Error("Invalid audio bytes type");
  }
  async function sha256Hex(buffer) {
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // extension/src/utils/internalMessages.ts
  var MESSAGE_TRANSCRIBE = "ZAP_TRANSCRIBE";

  // extension/src/utils/storageKeys.ts
  var STORAGE_API_KEY = "zap_openrouter_api_key";
  var STORAGE_MODELS = "zap_transcription_models";
  var STORAGE_LANGUAGE = "zap_transcription_language";
  var STORAGE_CACHE_TTL_MS = "zap_cache_ttl_ms";
  var CACHE_KEY_PREFIX = "zap_cache_v1:";
  var DEFAULT_MODEL_LINES = [
    "openai/gpt-4o-audio-preview",
    "openai/gpt-audio-mini",
    "google/gemini-2.0-flash-001"
  ];
  var DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;

  // extension/src/background.ts
  function decodeTranscribePayload(message) {
    if (typeof message.bytesBase64 === "string" && message.bytesBase64.length > 0) {
      try {
        return base64ToArrayBuffer(message.bytesBase64);
      } catch {
      }
    }
    if (message.bytes !== void 0) {
      return normalizeToArrayBuffer(message.bytes);
    }
    throw new Error("Audio bytes missing");
  }
  function parseModels(raw) {
    if (!raw?.trim()) return [...DEFAULT_MODEL_LINES];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => typeof x === "string" && x.trim().length > 0);
      }
    } catch {
    }
    return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  async function getCacheTtlMs() {
    const { [STORAGE_CACHE_TTL_MS]: ttl } = await chrome.storage.local.get(STORAGE_CACHE_TTL_MS);
    const n = typeof ttl === "string" ? Number(ttl) : typeof ttl === "number" ? ttl : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MS;
  }
  async function readCache(hash) {
    const key = `${CACHE_KEY_PREFIX}${hash}`;
    const { [key]: entry } = await chrome.storage.local.get(key);
    if (!entry || typeof entry !== "object") return null;
    const e = entry;
    if (typeof e.text !== "string" || typeof e.ts !== "number") return null;
    const ttl = await getCacheTtlMs();
    if (Date.now() - e.ts > ttl) {
      await chrome.storage.local.remove(key);
      return null;
    }
    return e.text;
  }
  async function writeCache(hash, text) {
    const key = `${CACHE_KEY_PREFIX}${hash}`;
    const payload = {
      [key]: { text, ts: Date.now() }
    };
    await chrome.storage.local.set(payload);
  }
  chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_TRANSCRIBE) return false;
      void (async () => {
        try {
          const { [STORAGE_API_KEY]: apiKey, [STORAGE_MODELS]: modelsRaw, [STORAGE_LANGUAGE]: lang } = await chrome.storage.local.get([STORAGE_API_KEY, STORAGE_MODELS, STORAGE_LANGUAGE]);
          const effectiveApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
          if (!effectiveApiKey) {
            sendResponse({ ok: false, message: chrome.i18n.getMessage("errorNoApiKey") });
            return;
          }
          const models = parseModels(typeof modelsRaw === "string" ? modelsRaw : void 0);
          if (!models.length) {
            sendResponse({ ok: false, message: "No models configured" });
            return;
          }
          const bytes = decodeTranscribePayload(message);
          const hash = await sha256Hex(bytes);
          const cached = await readCache(hash);
          if (cached) {
            sendResponse({ ok: true, text: cached, fromCache: true });
            return;
          }
          const languageHint = typeof lang === "string" && lang.trim() ? lang.trim() : void 0;
          const text = await transcribeWithOpenRouter({
            apiKey: effectiveApiKey,
            models,
            arrayBuffer: bytes,
            mimeType: message.mimeType,
            languageHint
          });
          await writeCache(hash, text);
          sendResponse({ ok: true, text, fromCache: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : chrome.i18n.getMessage("errorGeneric");
          sendResponse({ ok: false, message: msg });
        }
      })();
      return true;
    }
  );
})();
