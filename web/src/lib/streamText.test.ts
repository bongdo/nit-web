import { describe, expect, it } from "vitest";
import { revealChar, revealWords } from "./streamText";

describe("revealWords", () => {
  it("reveals whole words and their trailing space", () => {
    expect(revealWords("hello world ", 0)).toBe(6);
    expect(revealWords("hello world ", 6)).toBe(12);
  });

  it("does not reveal a half-arrived final word", () => {
    expect(revealWords("hello wor", 6)).toBe(6);
    expect(revealWords("hello world", 6)).toBe(6);
  });

  it("reveals a final word once the stream ends with punctuation", () => {
    expect(revealWords("hello world.", 0)).toBe(6);
    expect(revealWords("hello world.", 6)).toBe(12);
  });

  it("catches up when the backlog is large", () => {
    expect(revealWords(`${"word ".repeat(60)}`, 0)).toBe(25);
  });

  it("does not split an emoji", () => {
    expect(revealWords("a 😀 ", 0)).toBe(2);
  });

  it("keeps a very long unbroken token moving", () => {
    expect(revealWords("x".repeat(100), 0)).toBe(20);
  });

  it("stops at the end", () => {
    expect(revealWords("done.", 5)).toBe(5);
    expect(revealWords("", 0)).toBe(0);
  });
});

describe("revealChar", () => {
  it("advances one character without splitting an emoji", () => {
    expect(revealChar("a😀b", 0)).toBe(1);
    expect(revealChar("a😀b", 1)).toBe(3);
    expect(revealChar("a😀b", 3)).toBe(4);
    expect(revealChar("done", 4)).toBe(4);
  });
});
