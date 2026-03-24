export const MESSAGE_TRANSCRIBE = 'ZAP_TRANSCRIBE' as const;

export type TranscribeRequestMessage = {
  type: typeof MESSAGE_TRANSCRIBE;
  mimeType: string;
  /** Transporte fiável (string); preferir em relação a `bytes`. */
  bytesBase64: string;
  /** Legado / testes; no MV3 pode chegar corrompido ao SW. */
  bytes?: ArrayBuffer;
};

export type TranscribeResponseMessage =
  | { ok: true; text: string; fromCache?: boolean }
  | { ok: false; message: string; code?: string };
