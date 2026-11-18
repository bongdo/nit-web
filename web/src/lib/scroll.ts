export const TOP_EPSILON = 1;
export const EARLIER_THRESHOLD = 400;
export const BOTTOM_EPSILON = 1;

export type ScrollAnchor = {
  messageID: string;
  offset: number;
  bottom: boolean;
};

export type EarlierInput = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  hasEarlier: boolean;
  loading: boolean;
  pull?: boolean;
};

export function isAtTop(scrollTop: number): boolean {
  return scrollTop <= TOP_EPSILON;
}

export function isAtBottom({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_EPSILON;
}

export function shouldLoadEarlier({
  scrollTop,
  scrollHeight,
  clientHeight,
  hasEarlier,
  loading,
  pull = false,
}: EarlierInput): boolean {
  if (!hasEarlier || loading) return false;
  if (pull) return isAtTop(scrollTop);
  return scrollTop < EARLIER_THRESHOLD || scrollHeight <= clientHeight + EARLIER_THRESHOLD;
}
