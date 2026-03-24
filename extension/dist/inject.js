"use strict";
(() => {
  // extension/src/inject.ts
  (function zapTranscribeInject() {
    const w = window;
    if (w.__zapTranscribeInjected) return;
    w.__zapTranscribeInjected = true;
    const MSG = {
      source: "zap-transcribe",
      audioUrl: "audio-object-url",
      reqBlob: "request-blob",
      resBlob: "blob-response"
    };
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    const audioBlobs = /* @__PURE__ */ new Map();
    const MAX_BLOBS = 192;
    function trimBlobs() {
      while (audioBlobs.size > MAX_BLOBS) {
        const first = audioBlobs.keys().next().value;
        if (first === void 0) break;
        audioBlobs.delete(first);
      }
    }
    URL.createObjectURL = function(blob) {
      const url = origCreate(blob);
      try {
        const t = blob?.type ?? "";
        const size = blob?.size ?? 0;
        const looksAudio = typeof t === "string" && t.startsWith("audio/") || t === "" && size >= 400 && size <= 40 * 1024 * 1024;
        if (looksAudio) {
          audioBlobs.set(url, blob);
          trimBlobs();
          w.postMessage(
            {
              source: MSG.source,
              kind: MSG.audioUrl,
              url,
              mime: t && t.startsWith("audio/") ? t : "audio/ogg"
            },
            "*"
          );
        }
      } catch {
      }
      return url;
    };
    URL.revokeObjectURL = function(u) {
      origRevoke(u);
    };
    w.addEventListener("message", (e) => {
      if (e.source !== w || !e.data || e.data.source !== MSG.source || e.data.kind !== MSG.reqBlob) {
        return;
      }
      const { id, url } = e.data;
      const blob = audioBlobs.get(url);
      if (!blob) {
        w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: false }, "*");
        return;
      }
      void blob.arrayBuffer().then(
        (buffer) => {
          w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: true, buffer }, "*", [buffer]);
        },
        () => {
          w.postMessage({ source: MSG.source, kind: MSG.resBlob, id, ok: false }, "*");
        }
      );
    });
  })();
})();
