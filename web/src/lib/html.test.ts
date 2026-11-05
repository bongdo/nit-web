import { describe, expect, it } from "vitest";
import { htmlDocument, isHtmlLanguage, isPureHtml, looksLikeHtml, previewableHtml, withoutCode } from "./html";

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

describe("previewableHtml", () => {
  it("previews labeled html regardless of content", () => {
    expect(previewableHtml("<div>Hi</div>", "html")).toBe(true);
    expect(previewableHtml("<div>Hi</div>", "xhtml")).toBe(true);
  });

  it("previews an unlabeled full document", () => {
    expect(previewableHtml("<!doctype html><html><body><h1>Hi</h1></body></html>")).toBe(true);
  });

  it("previews an unlabeled html fragment", () => {
    expect(previewableHtml("<h1>Hi</h1>\n<p>Text</p>")).toBe(true);
  });

  it("does not preview labeled non-html", () => {
    expect(previewableHtml("<!doctype html><html><body>Hi</body></html>", "js")).toBe(false);
  });

  it("does not preview unlabeled prose", () => {
    expect(previewableHtml("Just a sentence with `code`.")).toBe(false);
  });

  it("does not preview unlabeled plain code", () => {
    expect(previewableHtml("const answer = 42;\nconsole.log(answer);")).toBe(false);
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

  it("leaves the canvas transparent so the app background shows through", () => {
    const result = htmlDocument("<h1>Hi</h1>");
    expect(result).toContain("background: transparent");
    expect(result).not.toContain("#fff");
  });

  it("uses the theme foreground", () => {
    expect(htmlDocument("<p>Hi</p>")).toContain("color: #18181b");
    expect(htmlDocument("<p>Hi</p>", true)).toContain("color: #e4e4e7");
  });

  it("recognises html fences", () => {
    expect(isHtmlLanguage("html")).toBe(true);
    expect(isHtmlLanguage("HTML")).toBe(true);
    expect(isHtmlLanguage("js")).toBe(false);
    expect(isHtmlLanguage(undefined)).toBe(false);
  });
});
