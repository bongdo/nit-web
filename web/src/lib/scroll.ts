export const EARLIER_THRESHOLD = 400;

export function needsEarlier(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop < EARLIER_THRESHOLD || scrollHeight <= clientHeight + EARLIER_THRESHOLD;
}
