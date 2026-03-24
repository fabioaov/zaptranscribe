/**
 * Whether `node` is `ancestor` or nested under it in the composed tree (light DOM + open shadow).
 * `ancestor.contains(node)` is false when `node` is inside a shadow root of a subtree under `ancestor`.
 */
export function isDescendantComposed(ancestor: Node, node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === ancestor) return true;
    if (current instanceof ShadowRoot) {
      current = current.host;
    } else {
      current = current.parentNode;
    }
  }
  return false;
}

/**
 * WhatsApp Web DOM helpers. Selectors change over time; prefer `audio` + `closest`.
 */
export function findMessageContainer(audio: HTMLAudioElement): HTMLElement | null {
  const byDataId =
    audio.closest<HTMLElement>('div[data-id]') ??
    audio.closest<HTMLElement>('[data-id]');
  if (byDataId) return byDataId;

  const byTestId =
    audio.closest<HTMLElement>('[data-testid="msg-container"]') ??
    audio.closest<HTMLElement>('[data-testid$="-message"]');
  if (byTestId) return byTestId;

  const row = audio.closest<HTMLElement>('[role="row"]');
  if (row) return row;

  return audio.parentElement;
}

/** Element to attach our UI block (below audio row when possible). */
export function findTranscriptionMount(audio: HTMLAudioElement): HTMLElement | null {
  const container = findMessageContainer(audio);
  if (!container) return null;

  const row = audio.closest<HTMLElement>('div[data-id]') ?? audio.parentElement;
  return row ?? container;
}
