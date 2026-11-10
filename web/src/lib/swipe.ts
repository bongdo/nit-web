export const SWIPE_SETTLE_MS = 140;
export const SWIPE_TRIGGER_PX = 48;

const MIN_DELTA = 4;

type WheelLike = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">;

export function horizontalScroll(event: WheelLike): number | null {
  if (event.ctrlKey || event.deltaMode !== 0) return null;
  const x = Math.abs(event.deltaX);
  if (x < MIN_DELTA || x <= Math.abs(event.deltaY)) return null;
  return event.deltaX;
}

export function swipeIntent(travel: number): "open" | "close" | null {
  if (travel <= -SWIPE_TRIGGER_PX) return "open";
  if (travel >= SWIPE_TRIGGER_PX) return "close";
  return null;
}
