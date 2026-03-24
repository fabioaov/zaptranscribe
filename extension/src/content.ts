import { arrayBufferToBase64 } from './utils/base64Payload';
import { MESSAGE_TRANSCRIBE, type TranscribeResponseMessage } from './utils/internalMessages';
import { findMessageContainer, isDescendantComposed } from './utils/whatsappSelectors';
import {
  collectVoiceMessageRoots,
  findVoiceUiMount,
} from './utils/voiceMessageDom';

const STYLE_ID = 'zap-transcribe-style';
const ROOT_CLASS = 'zap-transcribe-root';
const BTN_CLASS = 'zap-transcribe-btn';
const PANEL_CLASS = 'zap-transcribe-panel';

const ZAP_BRIDGE = {
  source: 'zap-transcribe',
  audioUrl: 'audio-object-url',
  reqBlob: 'request-blob',
  resBlob: 'blob-response',
} as const;

function msg(key: string): string {
  try {
    if (!chrome.runtime?.id) return key;
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
}

function isExtensionContextInvalidated(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return m.includes('Extension context invalidated');
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .${ROOT_CLASS} {
      margin: 6px 0 4px;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      font-size: 13px;
      line-height: 1.35;
    }
    .${BTN_CLASS} {
      all: revert;
      display: inline-block;
      margin: 0;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(0,0,0,0.12);
      background: rgba(0,0,0,0.04);
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
    }
    .${BTN_CLASS}:disabled {
      opacity: 0.65;
      cursor: default;
    }
    .${PANEL_CLASS} {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(0,0,0,0.05);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .zap-transcribe-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .zap-transcribe-copy {
      all: revert;
      font-size: 12px;
      padding: 2px 8px;
      cursor: pointer;
      border: none;
      background: transparent;
      text-decoration: underline;
      color: inherit;
    }
  `;
  document.documentElement.appendChild(el);
}

const INJECT_ATTR = 'data-zap-transcribe-inject';

function injectPageScript(): void {
  try {
    if (!chrome.runtime?.id) return;
    if (document.documentElement.hasAttribute(INJECT_ATTR)) return;
    document.documentElement.setAttribute(INJECT_ATTR, '');
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('dist/inject.js');
    s.onload = () => s.remove();
    s.onerror = () => document.documentElement.removeAttribute(INJECT_ATTR);
    (document.head ?? document.documentElement).appendChild(s);
  } catch {
    document.documentElement.removeAttribute(INJECT_ATTR);
  }
}

async function transcribeAudioBytes(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  if (!chrome.runtime?.id) {
    throw new Error(msg('errorExtensionReloaded'));
  }
  let response: TranscribeResponseMessage;
  try {
    response = (await chrome.runtime.sendMessage({
      type: MESSAGE_TRANSCRIBE,
      mimeType,
      bytesBase64: arrayBufferToBase64(bytes),
    })) as TranscribeResponseMessage;
  } catch (e) {
    if (isExtensionContextInvalidated(e)) {
      throw new Error(msg('errorExtensionReloaded'));
    }
    throw e;
  }

  if (!response || typeof response !== 'object') {
    throw new Error(msg('errorGeneric'));
  }
  if (!response.ok) {
    throw new Error(response.message || msg('errorGeneric'));
  }
  return response.text;
}

function requestBlobBytesFromPage(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random()}`;
    const onMsg = (e: MessageEvent): void => {
      if (
        e.source !== window ||
        !e.data ||
        e.data.source !== ZAP_BRIDGE.source ||
        e.data.kind !== ZAP_BRIDGE.resBlob ||
        e.data.id !== id
      ) {
        return;
      }
      window.removeEventListener('message', onMsg);
      if (e.data.ok && e.data.buffer instanceof ArrayBuffer) {
        resolve(e.data.buffer);
      } else {
        reject(new Error(msg('errorGeneric')));
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage(
      { source: ZAP_BRIDGE.source, kind: ZAP_BRIDGE.reqBlob, id, url },
      '*',
    );
    window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error(msg('errorGeneric')));
    }, 12000);
  });
}

/** `blob:` criado na página: ler primeiro via inject (mesmo mundo que o Blob); depois `fetch`. */
async function readBlobUrlBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (url.startsWith('blob:')) {
    try {
      return await requestBlobBytesFromPage(url);
    } catch {
      const res = await fetch(url, { credentials: 'omit', signal });
      if (!res.ok) throw new Error(msg('errorGeneric'));
      return (await res.blob()).arrayBuffer();
    }
  }
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok) throw new Error(msg('errorGeneric'));
  return (await res.blob()).arrayBuffer();
}

function sniffAudioMime(bytes: ArrayBuffer): string | null {
  const slice = bytes.byteLength <= 16 ? bytes : bytes.slice(0, 16);
  const u = new Uint8Array(slice);
  if (u.length < 4) return null;
  if (u[0] === 0x4f && u[1] === 0x67 && u[2] === 0x67 && u[3] === 0x53) return 'audio/ogg';
  if (u[0] === 0xff && (u[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) return 'audio/mpeg';
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) return 'audio/wav';
  return null;
}

function refineMimeForTranscribe(bytes: ArrayBuffer, mimeHint: string): string {
  const base = mimeHint.split(';')[0]?.trim().toLowerCase() ?? '';
  const generic =
    !base || base === 'application/octet-stream' || !base.startsWith('audio/');
  if (!generic) return mimeHint.split(';')[0].trim();
  const sniffed = sniffAudioMime(bytes);
  if (sniffed) return sniffed;
  return base && base !== 'application/octet-stream' ? base : 'audio/ogg';
}

function showErrorInPanel(panel: HTMLElement, err: unknown): void {
  panel.style.display = 'block';
  panel.textContent = err instanceof Error ? err.message : msg('errorGeneric');
}

async function fetchVoiceBytes(url: string, mimeHint: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const bytes = await readBlobUrlBytes(url);
  if (bytes.byteLength === 0) throw new Error(msg('errorEmptyAudio'));
  const mimeType = refineMimeForTranscribe(bytes, mimeHint || 'audio/ogg');
  return { bytes, mimeType };
}

function audioSourceKey(audio: HTMLAudioElement): string {
  const fromAudio = audio.currentSrc || audio.src || '';
  if (fromAudio) return fromAudio;
  const source = audio.querySelector<HTMLSourceElement>('source[src]');
  return source?.src ?? '';
}

function collectAudioElements(root: Node): HTMLAudioElement[] {
  const out: HTMLAudioElement[] = [];
  const visit = (node: Node): void => {
    if (node instanceof HTMLAudioElement) {
      out.push(node);
      return;
    }
    if (node instanceof ShadowRoot) {
      for (const c of node.children) {
        visit(c);
      }
      return;
    }
    if (node instanceof Element) {
      if (node.shadowRoot) {
        visit(node.shadowRoot);
      }
      for (const c of node.children) {
        visit(c);
      }
    }
  };
  visit(root);
  return out;
}

const audioUrlHooksAttached = new WeakSet<HTMLAudioElement>();

function findPlayerWrap(audio: HTMLAudioElement): HTMLElement | null {
  const container = findMessageContainer(audio);
  if (!container || !isDescendantComposed(container, audio)) return null;
  const wrap = audio.parentElement;
  return wrap instanceof HTMLElement ? wrap : null;
}

function ensureRoot(audio: HTMLAudioElement): void {
  const key = audioSourceKey(audio);
  if (!key || key.startsWith('data:')) return;

  const wrap = findPlayerWrap(audio);
  if (!wrap) return;

  const next = wrap.nextElementSibling;
  if (
    next instanceof HTMLElement &&
    next.classList.contains(ROOT_CLASS) &&
    audio.dataset.zapTranscribeBlobKey === key
  ) {
    return;
  }

  if (next instanceof HTMLElement && next.classList.contains(ROOT_CLASS)) {
    next.remove();
  }

  audio.dataset.zapTranscribeBlobKey = key;
  audio.dataset.processed = 'true';

  const root = document.createElement('div');
  root.className = ROOT_CLASS;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BTN_CLASS;
  btn.textContent = msg('buttonTranscribe');

  const toolbar = document.createElement('div');
  toolbar.className = 'zap-transcribe-toolbar';
  toolbar.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = PANEL_CLASS;
  panel.style.display = 'none';

  root.appendChild(toolbar);
  root.appendChild(panel);

  wrap.insertAdjacentElement('afterend', root);

  let busy = false;
  const ac = new AbortController();

  const setState = (state: 'idle' | 'loading' | 'error') => {
    if (state === 'loading') {
      btn.textContent = msg('buttonLoading');
      btn.disabled = true;
      panel.style.display = 'none';
      panel.textContent = '';
    } else if (state === 'error') {
      btn.textContent = msg('buttonError');
      btn.disabled = false;
    } else {
      btn.textContent = msg('buttonTranscribe');
      btn.disabled = false;
    }
  };

  const showTranscription = (text: string) => {
    panel.style.display = 'block';
    panel.textContent = text;

    let copyBtn = toolbar.querySelector<HTMLButtonElement>('.zap-transcribe-copy');
    if (!copyBtn) {
      copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'zap-transcribe-copy';
      copyBtn.textContent = msg('buttonCopy');
      toolbar.appendChild(copyBtn);
    }
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn!.textContent = msg('buttonCopied');
        window.setTimeout(() => {
          copyBtn!.textContent = msg('buttonCopy');
        }, 2000);
      } catch {
        /* ignore */
      }
    };
  };

  btn.addEventListener(
    'click',
    () => {
      void (async () => {
        if (busy) return;
        busy = true;
        setState('loading');
        try {
          const url = audioSourceKey(audio);
          if (!url) throw new Error(msg('errorGeneric'));

          const bytes = await readBlobUrlBytes(url, ac.signal);
          if (bytes.byteLength === 0) throw new Error(msg('errorEmptyAudio'));
          const mimeType = refineMimeForTranscribe(bytes, 'audio/ogg');

          const text = await transcribeAudioBytes(bytes, mimeType);
          showTranscription(text);
          setState('idle');
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          setState('error');
          showErrorInPanel(panel, e);
        } finally {
          busy = false;
        }
      })();
    },
    { signal: ac.signal },
  );
}

const pendingVoiceRoots: HTMLElement[] = [];
const orphanBlobs: { url: string; mime: string }[] = [];

/** Próxima mensagem de voz sem blob, pela ordem do documento (mais antiga primeiro). */
function takeOldestPendingVoiceRoot(): HTMLElement | null {
  for (let i = pendingVoiceRoots.length - 1; i >= 0; i--) {
    if (!document.documentElement.contains(pendingVoiceRoots[i]!)) {
      pendingVoiceRoots.splice(i, 1);
    }
  }
  if (pendingVoiceRoots.length === 0) return null;
  pendingVoiceRoots.sort((a, b) => {
    const r = a.compareDocumentPosition(b);
    if (r & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (r & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return pendingVoiceRoots.shift() ?? null;
}

function removeFromPendingVoiceRoots(root: HTMLElement): void {
  const idx = pendingVoiceRoots.indexOf(root);
  if (idx !== -1) pendingVoiceRoots.splice(idx, 1);
}

/** Atribui blobs órfãos a qualquer mensagem de voz registada sem URL (ordem do documento). */
function assignOrphansToUnpairedVoiceRoots(): void {
  if (orphanBlobs.length === 0) return;
  const candidates = collectVoiceMessageRoots(document.documentElement).filter(
    (r) => r.dataset.zapVoiceRegistered === '1' && !r.dataset.zapVoiceBlobUrl,
  );
  candidates.sort((a, b) => {
    const r = a.compareDocumentPosition(b);
    if (r & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (r & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  for (const root of candidates) {
    if (orphanBlobs.length === 0) break;
    const next = orphanBlobs.shift()!;
    root.dataset.zapVoiceBlobUrl = next.url;
    root.dataset.zapVoiceMime = next.mime;
    removeFromPendingVoiceRoots(root);
    ensureVoiceTranscribeUi(root);
  }
}

function pairOrEnqueueBlob(url: string, mime: string): void {
  const root = takeOldestPendingVoiceRoot();
  if (root) {
    if (!root.dataset.zapVoiceBlobUrl) {
      root.dataset.zapVoiceBlobUrl = url;
      root.dataset.zapVoiceMime = mime;
    }
    ensureVoiceTranscribeUi(root);
  } else {
    orphanBlobs.push({ url, mime });
    if (orphanBlobs.length > 40) orphanBlobs.shift();
  }
  assignOrphansToUnpairedVoiceRoots();
  enqueueNode(document.documentElement);
}

function registerVoiceMessageRoot(root: HTMLElement): void {
  if (root.dataset.zapVoiceRegistered === '1') {
    if (!root.dataset.zapVoiceBlobUrl && orphanBlobs.length > 0) {
      const next = orphanBlobs.shift()!;
      root.dataset.zapVoiceBlobUrl = next.url;
      root.dataset.zapVoiceMime = next.mime;
      removeFromPendingVoiceRoots(root);
    }
    ensureVoiceTranscribeUi(root);
    return;
  }
  root.dataset.zapVoiceRegistered = '1';

  if (!root.dataset.zapVoiceBlobUrl) {
    const next = orphanBlobs.shift();
    if (next) {
      root.dataset.zapVoiceBlobUrl = next.url;
      root.dataset.zapVoiceMime = next.mime;
      removeFromPendingVoiceRoots(root);
    } else {
      pendingVoiceRoots.push(root);
    }
  }
  ensureVoiceTranscribeUi(root);
}

function syncVoiceButton(messageRoot: HTMLElement, uiRoot: HTMLElement): void {
  const btn = uiRoot.querySelector<HTMLButtonElement>(`.${BTN_CLASS}`);
  if (!btn) return;
  const url = messageRoot.dataset.zapVoiceBlobUrl;
  if (url) {
    btn.disabled = false;
    btn.textContent = msg('buttonTranscribe');
  } else {
    btn.disabled = true;
    btn.textContent = msg('buttonWaitAudio');
  }
}

function ensureVoiceTranscribeUi(messageRoot: HTMLElement): void {
  let uiRoot = messageRoot.querySelector<HTMLElement>(`.${ROOT_CLASS}`);
  if (!uiRoot) {
    const mount = findVoiceUiMount(messageRoot) ?? messageRoot;
    uiRoot = document.createElement('div');
    uiRoot.className = ROOT_CLASS;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;

    const toolbar = document.createElement('div');
    toolbar.className = 'zap-transcribe-toolbar';
    toolbar.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    panel.style.display = 'none';

    uiRoot.appendChild(toolbar);
    uiRoot.appendChild(panel);
    mount.insertAdjacentElement('afterend', uiRoot);

    let busy = false;
    const ac = new AbortController();

    const setState = (state: 'idle' | 'loading' | 'error') => {
      if (state === 'loading') {
        btn.textContent = msg('buttonLoading');
        btn.disabled = true;
        panel.style.display = 'none';
        panel.textContent = '';
      } else if (state === 'error') {
        btn.textContent = msg('buttonError');
        btn.disabled = false;
      } else {
        syncVoiceButton(messageRoot, uiRoot!);
      }
    };

    const showTranscription = (text: string) => {
      panel.style.display = 'block';
      panel.textContent = text;

      let copyBtn = toolbar.querySelector<HTMLButtonElement>('.zap-transcribe-copy');
      if (!copyBtn) {
        copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'zap-transcribe-copy';
        copyBtn.textContent = msg('buttonCopy');
        toolbar.appendChild(copyBtn);
      }
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(text);
          copyBtn!.textContent = msg('buttonCopied');
          window.setTimeout(() => {
            copyBtn!.textContent = msg('buttonCopy');
          }, 2000);
        } catch {
          /* ignore */
        }
      };
    };

    btn.addEventListener(
      'click',
      () => {
        void (async () => {
          if (busy) return;
          const url = messageRoot.dataset.zapVoiceBlobUrl;
          if (!url) return;
          busy = true;
          setState('loading');
          try {
            const mimeHint = messageRoot.dataset.zapVoiceMime || 'audio/ogg';
            const { bytes, mimeType } = await fetchVoiceBytes(url, mimeHint);
            const text = await transcribeAudioBytes(bytes, mimeType);
            showTranscription(text);
            setState('idle');
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            setState('error');
            showErrorInPanel(panel, e);
          } finally {
            busy = false;
          }
        })();
      },
      { signal: ac.signal },
    );
  }
  syncVoiceButton(messageRoot, uiRoot);
}

const pendingRoots = new Set<Node>();
let rafScheduled = false;

function scheduleFlush(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  const run = () => {
    rafScheduled = false;
    const batch = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const n of batch) {
      const audios = collectAudioElements(n);
      for (const audio of audios) {
        attachAudioUrlListeners(audio);
        if (!audioSourceKey(audio)) continue;
        ensureRoot(audio);
      }
      const voiceRoots = collectVoiceMessageRoots(n);
      for (const vr of voiceRoots) {
        registerVoiceMessageRoot(vr);
      }
    }
  };
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => requestAnimationFrame(run), { timeout: 500 });
  } else {
    requestAnimationFrame(run);
  }
}

function enqueueNode(node: Node): void {
  pendingRoots.add(node);
  scheduleFlush();
}

function attachAudioUrlListeners(audio: HTMLAudioElement): void {
  if (audioUrlHooksAttached.has(audio)) return;
  audioUrlHooksAttached.add(audio);

  const bump = (): void => {
    enqueueNode(audio);
  };

  audio.addEventListener('loadedmetadata', bump, { passive: true });
  audio.addEventListener('loadeddata', bump, { passive: true });
  audio.addEventListener('canplay', bump, { passive: true });

  const mo = new MutationObserver(bump);
  mo.observe(audio, { attributes: true, attributeFilter: ['src'] });
  mo.observe(audio, { childList: true, subtree: true });
}

function onWindowMessage(e: MessageEvent): void {
  if (e.source !== window || !e.data || e.data.source !== ZAP_BRIDGE.source) return;
  if (e.data.kind === ZAP_BRIDGE.audioUrl) {
    const url = e.data.url as string;
    const mime = (e.data.mime as string) || 'audio/ogg';
    if (typeof url === 'string' && url.startsWith('blob:')) {
      pairOrEnqueueBlob(url, mime);
    }
  }
}

function observe(): void {
  try {
    if (!chrome.runtime?.id) return;
  } catch {
    return;
  }
  injectStyles();
  injectPageScript();
  window.addEventListener('message', onWindowMessage);

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => enqueueNode(n));
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  enqueueNode(document.documentElement);
}

observe();
