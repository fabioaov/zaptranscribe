import { transcribeWithOpenRouter } from './services/openrouter';
import { base64ToArrayBuffer } from './utils/base64Payload';
import { normalizeToArrayBuffer, sha256Hex } from './utils/hashBuffer';
import {
  MESSAGE_TRANSCRIBE,
  type TranscribeRequestMessage,
  type TranscribeResponseMessage,
} from './utils/internalMessages';
import {
  CACHE_KEY_PREFIX,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MODEL_LINES,
  STORAGE_API_KEY,
  STORAGE_CACHE_TTL_MS,
  STORAGE_LANGUAGE,
  STORAGE_MODELS,
} from './utils/storageKeys';

type CacheEntry = { text: string; ts: number };

function decodeTranscribePayload(message: TranscribeRequestMessage): ArrayBuffer {
  if (typeof message.bytesBase64 === 'string' && message.bytesBase64.length > 0) {
    try {
      return base64ToArrayBuffer(message.bytesBase64);
    } catch {
      /* fall through */
    }
  }
  if (message.bytes !== undefined) {
    return normalizeToArrayBuffer(message.bytes);
  }
  throw new Error('Audio bytes missing');
}

function parseModels(raw: string | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_MODEL_LINES];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
  } catch {
    /* fall through */
  }
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getCacheTtlMs(): Promise<number> {
  const { [STORAGE_CACHE_TTL_MS]: ttl } = await chrome.storage.local.get(STORAGE_CACHE_TTL_MS);
  const n = typeof ttl === 'string' ? Number(ttl) : typeof ttl === 'number' ? ttl : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MS;
}

async function readCache(hash: string): Promise<string | null> {
  const key = `${CACHE_KEY_PREFIX}${hash}`;
  const { [key]: entry } = await chrome.storage.local.get(key);
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as CacheEntry;
  if (typeof e.text !== 'string' || typeof e.ts !== 'number') return null;
  const ttl = await getCacheTtlMs();
  if (Date.now() - e.ts > ttl) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return e.text;
}

async function writeCache(hash: string, text: string): Promise<void> {
  const key = `${CACHE_KEY_PREFIX}${hash}`;
  const payload: Record<string, CacheEntry> = {
    [key]: { text, ts: Date.now() },
  };
  await chrome.storage.local.set(payload);
}

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener(
  (message: TranscribeRequestMessage, _sender, sendResponse: (r: TranscribeResponseMessage) => void) => {
    if (!message || message.type !== MESSAGE_TRANSCRIBE) return false;

    void (async () => {
      try {
        const { [STORAGE_API_KEY]: apiKey, [STORAGE_MODELS]: modelsRaw, [STORAGE_LANGUAGE]: lang } =
          await chrome.storage.local.get([STORAGE_API_KEY, STORAGE_MODELS, STORAGE_LANGUAGE]);

        const effectiveApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
        if (!effectiveApiKey) {
          sendResponse({ ok: false, message: chrome.i18n.getMessage('errorNoApiKey') });
          return;
        }

        const models = parseModels(typeof modelsRaw === 'string' ? modelsRaw : undefined);
        if (!models.length) {
          sendResponse({ ok: false, message: 'No models configured' });
          return;
        }

        const bytes = decodeTranscribePayload(message);
        const hash = await sha256Hex(bytes);
        const cached = await readCache(hash);
        if (cached) {
          sendResponse({ ok: true, text: cached, fromCache: true });
          return;
        }

        const languageHint = typeof lang === 'string' && lang.trim() ? lang.trim() : undefined;
        const text = await transcribeWithOpenRouter({
          apiKey: effectiveApiKey,
          models,
          arrayBuffer: bytes,
          mimeType: message.mimeType,
          languageHint,
        });

        await writeCache(hash, text);
        sendResponse({ ok: true, text, fromCache: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : chrome.i18n.getMessage('errorGeneric');
        sendResponse({ ok: false, message: msg });
      }
    })();

    return true;
  },
);
