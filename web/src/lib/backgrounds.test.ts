import { describe, expect, it } from "vitest";
import { VARIANTS } from "../components/Scene";
import { BACKGROUNDS, backgroundLabel } from "./backgrounds";

describe("backgrounds", () => {
  it("covers every scene variant plus random", () => {
    const ids = BACKGROUNDS.map((item) => item.id);
    expect(new Set(ids).size).toBe(BACKGROUNDS.length);
    for (const variant of VARIANTS) expect(ids).toContain(variant);
    expect(ids).toContain("random");
  });

  it("labels every background", () => {
    for (const item of BACKGROUNDS) expect(backgroundLabel(item.id)).toBe(item.label);
  });
});
