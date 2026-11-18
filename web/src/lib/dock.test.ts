import { describe, expect, it } from "vitest";
import { dockOpens, dockProgress } from "./dock";

describe("dockProgress", () => {
  it("follows a drag up from closed and clamps at open", () => {
    expect(dockProgress(0, -120, 600)).toBeCloseTo(0.2);
    expect(dockProgress(0, -900, 600)).toBe(1);
  });

  it("follows a drag down from open and clamps at closed", () => {
    expect(dockProgress(1, 300, 600)).toBeCloseTo(0.5);
    expect(dockProgress(1, 900, 600)).toBe(0);
  });

  it("keeps the current position without a height", () => {
    expect(dockProgress(0.7, -40, 0)).toBe(0.7);
  });
});

describe("dockOpens", () => {
  it("settles open only past the halfway point", () => {
    expect(dockOpens(0.45)).toBe(true);
    expect(dockOpens(0.44)).toBe(false);
  });
});
