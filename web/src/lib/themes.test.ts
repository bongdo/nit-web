import { describe, expect, it } from "vitest";
import { THEMES, themeIsDark, themeLabel } from "./themes";

describe("themes", () => {
  it("keeps the stock themes and unique ids", () => {
    expect(THEMES.map((item) => item.id)).toContain("light");
    expect(THEMES.map((item) => item.id)).toContain("dark");
    expect(new Set(THEMES.map((item) => item.id)).size).toBe(THEMES.length);
  });

  it("resolves system from the media query", () => {
    expect(themeIsDark("system", true)).toBe(true);
    expect(themeIsDark("system", false)).toBe(false);
  });

  it("resolves named themes from their hint", () => {
    expect(themeIsDark("nord", false)).toBe(true);
    expect(themeIsDark("solarized", true)).toBe(false);
  });

  it("labels every theme", () => {
    for (const item of THEMES) expect(themeLabel(item.id)).toBe(item.label);
  });
});
