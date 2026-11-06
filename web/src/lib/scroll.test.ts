import { describe, expect, it } from "vitest";
import { anchorIndex, EARLIER_THRESHOLD, needsEarlier } from "./scroll";

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
