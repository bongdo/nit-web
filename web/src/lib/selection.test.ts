import { describe, expect, it } from "vitest";
import { wordBounds } from "./selection";

const picked = (text: string, offset: number) => {
  const [start, end] = wordBounds(text, offset);
  return text.slice(start, end);
};

describe("wordBounds", () => {
  it("covers the word under the offset", () => {
    expect(picked("Hello brave world", 8)).toBe("brave");
    expect(picked("Hello brave world", 11)).toBe("brave");
    expect(picked("Hello brave world", 0)).toBe("Hello");
  });

  it("handles cyrillic and hyphenated words", () => {
    expect(picked("привет, мир", 3)).toBe("привет");
    expect(picked("long-term cache", 6)).toBe("long-term");
  });

  it("falls back to a single character between words", () => {
    expect(picked("a — b", 2)).toBe("—");
    expect(picked("   ", 1)).toBe(" ");
  });

  it("clamps offsets outside the text", () => {
    expect(picked("word", -5)).toBe("word");
    expect(picked("word", 40)).toBe("word");
    expect(wordBounds("", 0)).toEqual([0, 0]);
  });
});
