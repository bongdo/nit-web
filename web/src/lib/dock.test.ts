import { describe, expect, it } from "vitest";
import {
  dockComposerFade,
  dockFling,
  dockOpens,
  dockPanelFade,
  dockProgress,
  dockSettlesOpen,
} from "./dock";

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

describe("dock fades", () => {
  it("takes the composer out before the panel comes in", () => {
    expect(dockComposerFade(0)).toBe(0);
    expect(dockComposerFade(0.03)).toBeCloseTo(0.5);
    expect(dockComposerFade(0.06)).toBe(1);
    expect(dockPanelFade(0.04)).toBe(0);
    expect(dockPanelFade(0.1)).toBeCloseTo(0.5);
    expect(dockPanelFade(0.16)).toBe(1);
    expect(dockPanelFade(1)).toBe(1);
  });
});

describe("dockSettlesOpen", () => {
  it("opens a short fast flick up even below the halfway point", () => {
    expect(dockSettlesOpen(0.05, 1.2, 30)).toBe(true);
  });

  it("closes a short fast flick down while open", () => {
    expect(dockSettlesOpen(0.95, -1.2, -30)).toBe(false);
  });

  it("falls back to the halfway point for a slow drag", () => {
    expect(dockSettlesOpen(0.2, 0.1, 120)).toBe(false);
    expect(dockSettlesOpen(0.8, -0.1, -120)).toBe(true);
  });

  it("ignores a fast twitch that barely moved", () => {
    expect(dockFling(3, 6)).toBeNull();
    expect(dockSettlesOpen(0.1, 3, 6)).toBe(false);
  });
});
