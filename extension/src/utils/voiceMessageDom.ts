/**
 * Voice notes (PTT) no WhatsApp Web: player sem `<audio>` visível; usamos aria-label + waveform.
 */

import { isDescendantComposed } from './whatsappSelectors';

const VOICE_ARIA_HINTS = [
  ['voice', 'message'],
  ['voice', 'note'],
  ['play', 'voice'],
  ['mensagem', 'voz'],
  ['mensaje', 'voz'],
  ['reproduzir', 'voz'],
  ['audio', 'message'],
];

export function isVoicePlayButton(btn: HTMLButtonElement): boolean {
  const raw = btn.getAttribute('aria-label');
  if (!raw) return false;
  const a = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return VOICE_ARIA_HINTS.some(([x, y]) => a.includes(x) && a.includes(y));
}

export function findVoiceMessageRoot(from: Element): HTMLElement | null {
  return (
    from.closest<HTMLElement>('[data-id]') ??
    from.closest<HTMLElement>('.message-in') ??
    from.closest<HTMLElement>('.message-out') ??
    null
  );
}

export function findVoicePlayButton(messageRoot: HTMLElement): HTMLButtonElement | null {
  const visit = (node: Node): HTMLButtonElement | null => {
    if (node instanceof HTMLButtonElement && isVoicePlayButton(node)) {
      if (isDescendantComposed(messageRoot, node)) return node;
      return null;
    }
    if (node instanceof ShadowRoot) {
      for (const c of node.children) {
        const x = visit(c);
        if (x) return x;
      }
      return null;
    }
    if (node instanceof Element) {
      if (node.shadowRoot) {
        const x = visit(node.shadowRoot);
        if (x) return x;
      }
      for (const c of node.children) {
        const x = visit(c);
        if (x) return x;
      }
    }
    return null;
  };
  return visit(messageRoot);
}

/** Bloco com botão play + canvas (waveform); inserimos a UI logo a seguir. */
export function findVoiceUiMount(messageRoot: HTMLElement): HTMLElement | null {
  const playBtn = findVoicePlayButton(messageRoot);
  if (!playBtn) return null;

  let el: HTMLElement | null = playBtn;
  for (let d = 0; d < 14 && el; d++) {
    const p: HTMLElement | null = el.parentElement;
    if (!p || !isDescendantComposed(messageRoot, p)) break;
    const hasCanvas = !!p.querySelector('canvas');
    if (hasCanvas && isDescendantComposed(p, playBtn)) return p;
    el = p;
  }
  return playBtn.parentElement;
}

/** Percorre nós adicionados (e shadow aberto) e devolve raízes de mensagem de voz únicas. */
export function collectVoiceMessageRoots(node: Node): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];

  const visit = (n: Node): void => {
    if (n instanceof HTMLButtonElement && isVoicePlayButton(n)) {
      const r = findVoiceMessageRoot(n);
      if (r && !seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
      return;
    }
    if (n instanceof ShadowRoot) {
      for (const c of n.children) visit(c);
      return;
    }
    if (n instanceof Element) {
      if (n.shadowRoot) visit(n.shadowRoot);
      for (const c of n.children) visit(c);
    }
  };

  visit(node);
  return out;
}
