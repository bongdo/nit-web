import { describe, expect, it } from "vitest";
import { timeLabel } from "./time";

const afternoon = new Date(2026, 0, 1, 13, 5).getTime();
const midnight = new Date(2026, 0, 1, 0, 5).getTime();

describe("timeLabel", () => {
  it("uses a 24-hour clock by default", () => {
    expect(timeLabel(afternoon, "24h", "en-US")).toBe("13:05");
    expect(timeLabel(midnight, "24h", "en-US")).toBe("00:05");
  });

  it("uses AM/PM only when asked", () => {
    expect(timeLabel(afternoon, "12h", "en-US")).toBe("01:05 PM");
    expect(timeLabel(midnight, "12h", "en-US")).toBe("12:05 AM");
  });
});
