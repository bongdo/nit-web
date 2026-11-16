export const REVEAL_FRAME_MS = 40;
const TERMINAL = /[.!?…:;)\]}»"']/;

function boundary(text: string, at: number): boolean {
  if (at <= 0) return true;
  if (at >= text.length) {
    return /\s/.test(text[text.length - 1]) || TERMINAL.test(text[text.length - 1]);
  }
  if (/\s/.test(text[at - 1])) return true;
  return TERMINAL.test(text[at - 1]) && /\s/.test(text[at]);
}

export function revealWords(text: string, shown: number): number {
  if (shown >= text.length) return shown;
  const gap = text.length - shown;
  const step = Math.min(gap, Math.max(1, Math.min(24, Math.ceil(gap / 5))));
  const target = Math.min(text.length, shown + step);
  const limit = Math.min(text.length, target + 80);
  for (let at = target; at <= limit; at += 1) {
    if (boundary(text, at)) return at;
  }
  // A single token longer than the lookahead must not stall the stream forever.
  return limit - target > 40 ? target : shown;
}
