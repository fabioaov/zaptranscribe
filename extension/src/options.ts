import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MODEL_LINES,
  STORAGE_API_KEY,
  STORAGE_CACHE_TTL_MS,
  STORAGE_LANGUAGE,
  STORAGE_MODELS,
} from './utils/storageKeys';

function t(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

function setText(id: string, messageKey: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = t(messageKey);
}

async function load(): Promise<void> {
  const { [STORAGE_API_KEY]: key, [STORAGE_MODELS]: models, [STORAGE_LANGUAGE]: lang } =
    await chrome.storage.local.get([STORAGE_API_KEY, STORAGE_MODELS, STORAGE_LANGUAGE]);

  const apiInput = document.getElementById('apiKey') as HTMLInputElement | null;
  const modelsInput = document.getElementById('models') as HTMLTextAreaElement | null;
  const langInput = document.getElementById('language') as HTMLInputElement | null;

  if (apiInput && typeof key === 'string') apiInput.value = key;
  if (modelsInput) {
    if (typeof models === 'string' && models.trim()) {
      try {
        const parsed = JSON.parse(models) as unknown;
        if (Array.isArray(parsed)) {
          modelsInput.value = parsed.filter((x): x is string => typeof x === 'string').join('\n');
        } else {
          modelsInput.value = models;
        }
      } catch {
        modelsInput.value = models;
      }
    } else {
      modelsInput.value = DEFAULT_MODEL_LINES.join('\n');
    }
  }
  if (langInput && typeof lang === 'string') langInput.value = lang;
}

async function save(): Promise<void> {
  const status = document.getElementById('status');
  const apiInput = document.getElementById('apiKey') as HTMLInputElement | null;
  const modelsInput = document.getElementById('models') as HTMLTextAreaElement | null;
  const langInput = document.getElementById('language') as HTMLInputElement | null;

  const apiKey = apiInput?.value ?? '';
  const modelsLines =
    modelsInput?.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  await chrome.storage.local.set({
    [STORAGE_API_KEY]: apiKey.trim(),
    [STORAGE_MODELS]: JSON.stringify(modelsLines.length ? modelsLines : DEFAULT_MODEL_LINES),
    [STORAGE_LANGUAGE]: (langInput?.value ?? '').trim(),
    [STORAGE_CACHE_TTL_MS]: String(DEFAULT_CACHE_TTL_MS),
  });

  if (status) status.textContent = t('saved');
}

function init(): void {
  setText('heading', 'optionsHeading');
  setText('intro', 'optionsIntro');
  setText('apiKeyLabel', 'apiKeyLabel');
  setText('modelsLabel', 'modelsLabel');
  setText('modelsHint', 'modelsHint');
  setText('languageLabel', 'languageLabel');
  setText('languageHint', 'languageHint');
  const saveBtn = document.getElementById('save');
  if (saveBtn) saveBtn.textContent = t('save');

  void load();

  saveBtn?.addEventListener('click', () => void save());
}

init();
