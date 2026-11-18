import { describe, expect, it } from "vitest";
import { parseDelimited } from "./csv";

describe("parseDelimited", () => {
  it("splits rows and fields", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps quoted commas, quotes and newlines", () => {
    expect(parseDelimited('name,note\n"a,b","say ""hi"""\n"two\nlines",x')).toEqual([
      ["name", "note"],
      ["a,b", 'say "hi"'],
      ["two\nlines", "x"],
    ]);
  });

  it("accepts tabs and ignores CR", () => {
    expect(parseDelimited("a\tb\r\n1\t2\r\n", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseDelimited("")).toEqual([]);
  });
});
