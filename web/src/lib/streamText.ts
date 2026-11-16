export const REVEAL_FRAME_MS = 40;

export function revealAdvance(text: string, shown: number): number {
  const gap = text.length - shown;
  if (gap <= 0) return shown;
  const step = Math.min(gap, Math.max(1, Math.min(24, Math.ceil(gap / 5))));
  let next = shown + step;
  const last = text.charCodeAt(next - 1);
  if (next < text.length && last >= 0xd800 && last <= 0xdbff) next += 1;
  return next;
}
