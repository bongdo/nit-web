import { describe, expect, it } from "vitest";
import { EARLIER_THRESHOLD, needsEarlier } from "./scroll";

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
