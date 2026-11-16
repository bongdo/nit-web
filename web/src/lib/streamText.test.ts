import { describe, expect, it } from "vitest";
import { revealAdvance } from "./streamText";

describe("revealAdvance", () => {
  it("moves at least one character", () => {
    expect(revealAdvance("abcdef", 0)).toBe(1);
    expect(revealAdvance("abcdef", 5)).toBe(6);
  });

  it("catches up faster when the backlog is large", () => {
    expect(revealAdvance("x".repeat(200), 0)).toBe(24);
    expect(revealAdvance("x".repeat(200), 196)).toBe(200);
  });

  it("does not split a surrogate pair", () => {
    expect(revealAdvance("a😀", 1)).toBe(3);
    expect(revealAdvance("a😀😀", 3)).toBe(5);
  });

  it("stops at the end", () => {
    expect(revealAdvance("done", 4)).toBe(4);
    expect(revealAdvance("", 0)).toBe(0);
  });
});
