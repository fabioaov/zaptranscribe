function tagOf(x: unknown): string {
  return Object.prototype.toString.call(x);
}

function copyArrayBuffer(ab: ArrayBuffer): ArrayBuffer {
  return new Uint8Array(ab).slice().buffer;
}

/**
 * Ensures runtime messages yield a real ArrayBuffer for SubtleCrypto and OpenRouter.
 * Between content script and service worker, `instanceof ArrayBuffer` can be false even
 * for a cloned buffer; use `Object.prototype.toString` and copy via Uint8Array.
 */
export function normalizeToArrayBuffer(input: unknown): ArrayBuffer {
  if (input === null || input === undefined) {
    throw new Error('Audio bytes missing');
  }
  const tag = tagOf(input);
  if (input instanceof ArrayBuffer || tag === '[object ArrayBuffer]') {
    return copyArrayBuffer(input as ArrayBuffer);
  }
  if (tag === '[object SharedArrayBuffer]') {
    const u = new Uint8Array(input as SharedArrayBuffer);
    return u.slice().buffer;
  }
  if (ArrayBuffer.isView(input)) {
    const v = input as ArrayBufferView;
    const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return u.slice().buffer;
  }
  if (typeof input === 'object' && input !== null && 'buffer' in input) {
    const v = input as { buffer: unknown; byteOffset?: number; byteLength?: number };
    const buf = v.buffer;
    const off = typeof v.byteOffset === 'number' ? v.byteOffset : 0;
    const len = typeof v.byteLength === 'number' ? v.byteLength : -1;
    if (len >= 0 && (buf instanceof ArrayBuffer || tagOf(buf) === '[object ArrayBuffer]')) {
      const u = new Uint8Array(buf as ArrayBuffer, off, len);
      return u.slice().buffer;
    }
  }
  throw new Error('Invalid audio bytes type');
}

/** SHA-256 hex digest of an ArrayBuffer (service worker / window). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
