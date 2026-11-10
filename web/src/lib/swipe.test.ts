import { describe, expect, it } from "vitest";
import { horizontalScroll, swipeIntent } from "./swipe";

const wheel = (deltaX: number, deltaY = 0, overrides: Partial<WheelEvent> = {}) =>
  ({ deltaX, deltaY, deltaMode: 0, ctrlKey: false, ...overrides }) as WheelEvent;

describe("horizontalScroll", () => {
  it("reads a horizontal trackpad swipe", () => {
    expect(horizontalScroll(wheel(-30, 2))).toBe(-30);
    expect(horizontalScroll(wheel(40, -2))).toBe(40);
  });

  it("ignores vertical scrolling, tiny noise, pinch zoom and line mode", () => {
    expect(horizontalScroll(wheel(10, 40))).toBeNull();
    expect(horizontalScroll(wheel(2, 1))).toBeNull();
    expect(horizontalScroll(wheel(30, 0, { ctrlKey: true }))).toBeNull();
    expect(horizontalScroll(wheel(30, 0, { deltaMode: 1 }))).toBeNull();
  });
});

describe("swipeIntent", () => {
  it("turns a long enough swipe into one toggle", () => {
    expect(swipeIntent(-48)).toBe("open");
    expect(swipeIntent(48)).toBe("close");
  });

  it("ignores short drags", () => {
    expect(swipeIntent(-20)).toBeNull();
    expect(swipeIntent(0)).toBeNull();
  });
});
