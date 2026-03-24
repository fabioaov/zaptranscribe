/**
 * Runs in the page context (not the isolated content-script world).
 * Tracks audio blobs from URL.createObjectURL and answers byte requests via postMessage.
 */
(function zapTranscribeInject() {
  const w = window as Window & {
    __zapTranscribeInjected?: boolean;
  };
  if (w.__zapTranscribeInjected) return;
  w.__zapTranscribeInjected = true;

  const MSG = {
    source: 'zap-transcribe',
    audioUrl: 'audio-object-url',
    reqBlob: 'request-blob',
    resBlob: 'blob-response',
  } as const;

  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);

  const audioBlobs = new Map<string, Blob>();

  /** Limite de URLs em memória; aumentar reduz expulsão em chats com muitas notas (tradeoff: mais RAM). */
  const MAX_BLOBS = 192;
  function trimBlobs(): void {
    while (audioBlobs.size > MAX_BLOBS) {
      const first = audioBlobs.keys().next().value as string | undefined;
      if (first === undefined) break;
      audioBlobs.delete(first);
    }
  }

  URL.createObjectURL = function (blob: Blob): string {
    const url = origCreate(blob);
    try {
      const t = blob?.type ?? '';
      const size = blob?.size ?? 0;
      const looksAudio =
        (typeof t === 'string' && t.startsWith('audio/')) ||
        (t === '' && size >= 400 && size <= 40 * 1024 * 1024);
      if (looksAudio) {
        audioBlobs.set(url, blob);
        trimBlobs();
        w.postMessage(
          {
            source: MSG.source,
            kind: MSG.audioUrl,
            url,
            mime: t && t.startsWith('audio/') ? t : 'audio/ogg',
          },
          '*',
        );
      }
    } catch {
      /* ignore */
    }
    return url;
  };

  URL.revokeObjectURL = function (u: string): void {
    origRevoke(u);
    /* Mantém o Blob no mapa para o bridge pós-revoke (fetch(blob:) deixa de funcionar). */
  };

  w.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== w || !e.data || e.data.source !== MSG.source || e.data.kind !== MSG.reqBlob) {
      return;
    }
    const { id, url } = e.data as { id: string; url: string };
    const blob = audioBlobs.get(url);
    if (!blob) {
      w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: false }, '*');
      return;
    }
    void blob.arrayBuffer().then(
      (buffer) => {
        w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: true, buffer }, '*', [buffer]);
      },
      () => {
        w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: false }, '*');
      },
    );
  });
})();
