import { describe, expect, it } from "vitest";
import {
  attachmentHref,
  attachmentKind,
  attachmentNameFromHref,
  attachmentWarning,
  fileType,
  isLocalFileHref,
} from "./attachments";

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

  it("maps popular extensions to file types for icons and players", () => {
    expect(fileType({ name: "photo.png" })).toBe("image");
    expect(fileType({ name: "doc.pdf" })).toBe("pdf");
    expect(fileType({ name: "track.mp3" })).toBe("audio");
    expect(fileType({ name: "clip.mp4" })).toBe("video");
    expect(fileType({ name: "bundle.zip" })).toBe("archive");
    expect(fileType({ name: "data.csv" })).toBe("spreadsheet");
    expect(fileType({ name: "slides.pptx" })).toBe("presentation");
    expect(fileType({ name: "main.go" })).toBe("code");
    expect(fileType({ name: "package.json" })).toBe("json");
    expect(fileType({ name: "notes.md" })).toBe("document");
    expect(fileType({ name: "server.pem" })).toBe("key");
    expect(fileType({ name: "unknown" })).toBe("other");
  });

  it("recognizes local file links and derives the name", () => {
    const href = "/api/file?path=file%3A%2F%2F%2Ftmp%2Fnit-gui-1-track.mp3";
    expect(isLocalFileHref(href)).toBe(true);
    expect(isLocalFileHref("https://example.com/a.mp3")).toBe(false);
    expect(attachmentNameFromHref(href)).toBe("nit-gui-1-track.mp3");
  });

  it("warns when the model cannot read the attachment", () => {
    expect(attachmentWarning({ name: "a.pdf" }, model(["text", "image"]))).toContain("PDF");
    expect(attachmentWarning({ name: "a.png" }, model(["text"]))).toContain("images");
    expect(attachmentWarning({ name: "a.zip" }, model(["text"]))).toContain("not sent");
    expect(attachmentWarning({ name: "a.pdf" }, model(["text", "pdf"]))).toBeUndefined();
  });
});
