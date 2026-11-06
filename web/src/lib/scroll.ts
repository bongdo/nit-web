export const EARLIER_THRESHOLD = 400;
export const BOTTOM_GAP = 140;

export type ScrollAnchor = {
  messageID: string;
  offset: number;
  bottom: boolean;
};

export function needsEarlier(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop < EARLIER_THRESHOLD || scrollHeight <= clientHeight + EARLIER_THRESHOLD;
}

export function anchorIndex(bottoms: number[], viewportTop: number): number {
  let low = 0;
  let high = bottoms.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (bottoms[middle] > viewportTop) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
}
