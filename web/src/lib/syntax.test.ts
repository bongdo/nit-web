import { describe, expect, it } from "vitest";
import { tokenize } from "./syntax";

const parts = (code: string) =>
  tokenize(code).map((span) => [code.slice(span.start, span.end), span.kind]);

describe("tokenize", () => {
  it("covers an unfamiliar language from the shared keyword list", () => {
    const code = 'module main;\nfn void main() { io::printn("hi"); }';
    expect(parts(code)).toEqual([
      ["module", "keyword"],
      [";", "punctuation"],
      ["fn", "keyword"],
      ["void", "keyword"],
      ["(", "bracket1"],
      [")", "bracket1"],
      ["{", "bracket1"],
      ["::", "punctuation"],
      ["(", "bracket2"],
      ['"hi"', "string"],
      [")", "bracket2"],
      [";", "punctuation"],
      ["}", "bracket1"],
    ]);
  });

  it("matches keywords case-insensitively when upper-cased", () => {
    expect(parts("SELECT id FROM t")[0]).toEqual(["SELECT", "keyword"]);
    expect(parts("select id")[0]).toEqual(["select", "keyword"]);
  });

  it("keeps esoteric keywords out of plain identifiers", () => {
    const words = parts("fault defer comptime proc nextcase identifier");
    expect(words).toEqual([
      ["fault", "keyword"],
      ["defer", "keyword"],
      ["comptime", "keyword"],
      ["proc", "keyword"],
      ["nextcase", "keyword"],
    ]);
  });

  it("nests brackets by depth", () => {
    const code = "f(a[b])";
    expect(parts(code)).toEqual([
      ["(", "bracket1"],
      ["[", "bracket2"],
      ["]", "bracket2"],
      [")", "bracket1"],
    ]);
  });

  it("reads line comments in the common styles", () => {
    expect(parts("x = 1; // note")).toEqual([
      ["=", "punctuation"],
      ["1", "number"],
      [";", "punctuation"],
      ["// note", "comment"],
    ]);
    expect(parts("y = 2 # note")).toEqual([
      ["=", "punctuation"],
      ["2", "number"],
      ["# note", "comment"],
    ]);
    expect(parts("z = 3 -- note")).toEqual([
      ["=", "punctuation"],
      ["3", "number"],
      ["-- note", "comment"],
    ]);
  });

  it("leaves preprocessor lines alone", () => {
    const kinds = parts("#include <stdio.h>");
    expect(kinds.some(([, kind]) => kind === "comment")).toBe(false);
    expect(kinds[0]).toEqual(["#", "punctuation"]);
  });

  it("tells urls from paths", () => {
    expect(parts("see https://example.com/a")).toEqual([["https://example.com/a", "url"]]);
    expect(parts("open /usr/local/bin")).toEqual([["/usr/local/bin", "path"]]);
  });

  it("does not treat a block comment as punctuation soup", () => {
    expect(parts("/* a; b */ x")).toEqual([
      ["/* a; b */", "comment"],
    ]);
  });

  it("terminates on empty and whitespace input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   \n\t")).toEqual([]);
  });
});
