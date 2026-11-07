import { describe, expect, it } from "vitest";
import { splitSpeech } from "./speech";

describe("splitSpeech", () => {
  it("keeps paragraphs as separate segments", () => {
    expect(splitSpeech("Первое предложение.\n\nВторое предложение.")).toEqual([
      "Первое предложение.",
      "Второе предложение.",
    ]);
  });

  it("splits a long paragraph at sentence boundaries", () => {
    const text = "Первое предложение. ".repeat(30).trim();
    const segments = splitSpeech(text, 80);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(80);
      expect(segment.endsWith(".")).toBe(true);
    }
  });

  it("never splits a fenced code block", () => {
    const text = "Код:\n\n```go\nfunc main() {\n\n\n}\n```\n\nГотово.";
    expect(splitSpeech(text, 20)).toEqual(["Код:", "```go\nfunc main() {\n\n\n}\n```", "Готово."]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSpeech("  \n\n ")).toEqual([]);
  });
});
