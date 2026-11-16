import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdown";

describe("splitMarkdownBlocks", () => {
  it("splits paragraphs at blank lines", () => {
    expect(splitMarkdownBlocks("First.\n\nSecond.\n")).toEqual(["First.\n\n", "Second.\n"]);
  });

  it("keeps a fenced code block with blank lines together", () => {
    expect(splitMarkdownBlocks("Text.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.")).toEqual([
      "Text.\n\n",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n",
      "After.",
    ]);
  });

  it("keeps a loose list together", () => {
    expect(splitMarkdownBlocks("- first\n\n- second")).toBeNull();
  });

  it("bails out on definitions and raw block html", () => {
    expect(splitMarkdownBlocks("[ref]: https://example.com\n\nText.")).toBeNull();
    expect(splitMarkdownBlocks("<div>\n\nText.</div>")).toBeNull();
  });

  it("returns null for a single block", () => {
    expect(splitMarkdownBlocks("Just one paragraph.")).toBeNull();
  });
});
