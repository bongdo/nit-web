import { describe, expect, it } from "vitest";
import { attachmentHref, attachmentKind, attachmentWarning } from "./attachments";

const model = (input: string[]) => ({ name: "Model", capabilities: { input } });

describe("attachments", () => {
  it("classifies by mime before extension", () => {
    expect(attachmentKind({ mime: "image/png", name: "x.bin" })).toBe("image");
    expect(attachmentKind({ mime: "application/pdf", name: "x" })).toBe("pdf");
    expect(attachmentKind({ mime: "text/markdown", name: "x" })).toBe("text");
    expect(attachmentKind({ name: "shot.PDF" })).toBe("pdf");
    expect(attachmentKind({ name: "notes.md" })).toBe("text");
    expect(attachmentKind({ name: "archive.zip" })).toBe("other");
  });

  it("maps local files through the proxy and data to a data url", () => {
    expect(attachmentHref({ source: { uri: "file:///tmp/a b.pdf" } })).toBe(
      "/api/file?path=file%3A%2F%2F%2Ftmp%2Fa%20b.pdf",
    );
    expect(attachmentHref({ uri: "https://example.com/a.png" })).toBe(
      "https://example.com/a.png",
    );
    expect(attachmentHref({ data: "UEJEUg==", mime: "application/pdf" })).toBe(
      "data:application/pdf;base64,UEJEUg==",
    );
  });

  it("prefers the original source over a media uri", () => {
    expect(
      attachmentHref({
        uri: "media:abc",
        source: { uri: "file:///tmp/nit-gui-1-a.png" },
      }),
    ).toBe("/api/file?path=file%3A%2F%2F%2Ftmp%2Fnit-gui-1-a.png");
  });

  it("uses inline data when the source is outside the served upload root", () => {
    expect(
      attachmentHref({
        data: "UEJEUg==",
        mime: "application/pdf",
        source: { uri: "file:///home/ubuntu/secret.pdf" },
      }),
    ).toBe("data:application/pdf;base64,UEJEUg==");
  });

  it("warns when the model cannot read the attachment", () => {
    expect(attachmentWarning({ name: "a.pdf" }, model(["text", "image"]))).toContain("PDF");
    expect(attachmentWarning({ name: "a.png" }, model(["text"]))).toContain("images");
    expect(attachmentWarning({ name: "a.zip" }, model(["text"]))).toContain("not sent");
    expect(attachmentWarning({ name: "a.pdf" }, model(["text", "pdf"]))).toBeUndefined();
  });
});
