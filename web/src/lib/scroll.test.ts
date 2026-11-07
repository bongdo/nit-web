import { describe, expect, it } from "vitest";
import {
  anchorIndex,
  EARLIER_THRESHOLD,
  isAtTop,
  needsEarlier,
  shouldLoadEarlier,
  TOP_EPSILON,
} from "./scroll";

const base = {
  scrollHeight: 5000,
  clientHeight: 800,
  hasEarlier: true,
  loading: false,
};

describe("shouldLoadEarlier", () => {
  it("1. loads at the exact top", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: 0 })).toBe(true);
  });

  it("2. loads within the top epsilon", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: TOP_EPSILON })).toBe(true);
  });

  it("3. loads just before the earlier threshold", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: EARLIER_THRESHOLD - 1 })).toBe(true);
  });

  it("4. does not load at the earlier threshold", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: EARLIER_THRESHOLD })).toBe(false);
  });

  it("5. fills a transcript shorter than the viewport", () => {
    expect(
      shouldLoadEarlier({
        ...base,
        scrollTop: 500,
        scrollHeight: 900,
        clientHeight: 800,
      }),
    ).toBe(true);
  });

  it("6. does not load when there is no earlier page", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: 0, hasEarlier: false })).toBe(false);
  });

  it("7. does not duplicate a request while loading", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: 0, loading: true })).toBe(false);
  });

  it("8. loads on a pull gesture at the exact top", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: 0, pull: true })).toBe(true);
  });

  it("9. loads on a pull gesture within the top epsilon", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: TOP_EPSILON, pull: true })).toBe(true);
  });

  it("10. ignores a pull gesture away from the top", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: TOP_EPSILON + 1, pull: true })).toBe(false);
  });

  it("11. handles negative overscroll as the top", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: -20 })).toBe(true);
    expect(shouldLoadEarlier({ ...base, scrollTop: -20, pull: true })).toBe(true);
  });

  it("12. ignores a pull at the top while loading or without earlier pages", () => {
    expect(shouldLoadEarlier({ ...base, scrollTop: 0, pull: true, loading: true })).toBe(false);
    expect(shouldLoadEarlier({ ...base, scrollTop: 0, pull: true, hasEarlier: false })).toBe(false);
  });
});

describe("isAtTop", () => {
  it("accepts zero, negative and epsilon positions only", () => {
    expect(isAtTop(0)).toBe(true);
    expect(isAtTop(-4)).toBe(true);
    expect(isAtTop(TOP_EPSILON)).toBe(true);
    expect(isAtTop(TOP_EPSILON + 1)).toBe(false);
  });
});

describe("needsEarlier", () => {
  it("loads before the user reaches the top", () => {
    expect(needsEarlier(EARLIER_THRESHOLD - 1, 5000, 800)).toBe(true);
    expect(needsEarlier(EARLIER_THRESHOLD, 5000, 800)).toBe(false);
  });

  it("fills a transcript shorter than the viewport", () => {
    expect(needsEarlier(0, 900, 800)).toBe(true);
    expect(needsEarlier(500, 1300, 800)).toBe(false);
  });
});

describe("anchorIndex", () => {
  it("picks the first row that reaches below the viewport top", () => {
    expect(anchorIndex([100, 300, 500, 700], 250)).toBe(1);
    expect(anchorIndex([100, 300, 500, 700], 300)).toBe(2);
  });

  it("handles rows that straddle the viewport top", () => {
    expect(anchorIndex([-500, 40, 200], -400)).toBe(1);
    expect(anchorIndex([-500, 40, 200], -600)).toBe(0);
  });

  it("returns -1 when every row ends above the viewport", () => {
    expect(anchorIndex([], 0)).toBe(-1);
    expect(anchorIndex([100, 200], 300)).toBe(-1);
  });
});
