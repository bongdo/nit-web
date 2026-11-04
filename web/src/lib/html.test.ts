import { describe, expect, it } from "vitest";
import { htmlDocument, isHtmlLanguage, isPureHtml, looksLikeHtml, withoutCode } from "./html";

describe("looksLikeHtml", () => {
  it("detects a plain html element in a message", () => {
    expect(looksLikeHtml("<h1>Hi</h1>")).toBe(true);
  });

  it("detects a full document", () => {
    expect(looksLikeHtml("<!doctype html><html><body>Hi</body></html>")).toBe(true);
  });

  it("ignores html inside fenced code", () => {
    expect(looksLikeHtml("Example:\n\n```html\n<div>Hello</div>\n```\n")).toBe(false);
  });

  it("ignores html inside inline code", () => {
    expect(looksLikeHtml("Use `<div>` for a block.")).toBe(false);
  });

  it("does not treat markdown as html", () => {
    expect(looksLikeHtml("## Heading\n\nSome **bold** text.")).toBe(false);
  });

  it("distinguishes a pure html message from markdown mentioning tags", () => {
    expect(isPureHtml("<h1>Hi</h1>")).toBe(true);
    expect(isPureHtml("<!doctype html><html></html>")).toBe(true);
    expect(isPureHtml("Here is <b>bold</b> inside prose.")).toBe(false);
    expect(isPureHtml("## Heading\n\n<h1>Hi</h1>")).toBe(false);
  });

  it("strips fenced and inline code", () => {
    expect(withoutCode("a `b` c\n```\nd\n```")).not.toContain("b");
    expect(withoutCode("a `b` c\n```\nd\n```")).not.toContain("d");
  });
});

describe("htmlDocument", () => {
  it("wraps a fragment", () => {
    const result = htmlDocument("<h1>Hi</h1>");
    expect(result).toContain("<!doctype html>");
    expect(result).toContain("<h1>Hi</h1>");
  });

  it("keeps a full document unchanged", () => {
    const source = "<!doctype html><html><body>Hi</body></html>";
    expect(htmlDocument(source)).toBe(source);
  });

  it("recognises html fences", () => {
    expect(isHtmlLanguage("html")).toBe(true);
    expect(isHtmlLanguage("HTML")).toBe(true);
    expect(isHtmlLanguage("js")).toBe(false);
    expect(isHtmlLanguage(undefined)).toBe(false);
  });
});
