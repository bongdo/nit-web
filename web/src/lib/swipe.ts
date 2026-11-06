export const SWIPE_SETTLE_MS = 140;

const SWIPE_TRAVEL_RATIO = 0.6;
const OPEN_AT = 0.6;
const CLOSE_AT = 0.25;
const MIN_DELTA = 4;

type WheelLike = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">;

export function horizontalScroll(event: WheelLike): number | null {
  if (event.ctrlKey || event.deltaMode !== 0) return null;
  const x = Math.abs(event.deltaX);
  if (x < MIN_DELTA || x <= Math.abs(event.deltaY)) return null;
  return event.deltaX;
}

export function advanceSwipe(position: number, deltaX: number, width: number): number {
  const travel = Math.max(1, width * SWIPE_TRAVEL_RATIO);
  return Math.min(1, Math.max(0, position - deltaX / travel));
}

export function settleSwipe(position: number, lastStep: number): boolean {
  if (position >= OPEN_AT) return true;
  if (position <= CLOSE_AT) return false;
  return lastStep > 0;
}
