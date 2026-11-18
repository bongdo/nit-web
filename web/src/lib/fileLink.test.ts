import { describe, expect, it } from "vitest";
import {
  annotatable,
  executablePath,
  fileTarget,
  previewable,
  rawHref,
  viewHref,
} from "./fileLink";

describe("fileTarget", () => {
  it("recognises workspace paths", () => {
    expect(fileTarget("docs/decisions.md")).toEqual({ path: "docs/decisions.md" });
    expect(fileTarget("bin/check")).toEqual({ path: "bin/check" });
    expect(fileTarget("/home/ubuntu/Projects/nit-gui/README.md")).toEqual({
      path: "/home/ubuntu/Projects/nit-gui/README.md",
    });
    expect(fileTarget("./src/App.tsx")).toEqual({ path: "./src/App.tsx" });
    expect(fileTarget("package.json")).toEqual({ path: "package.json" });
    expect(fileTarget("README.md")).toEqual({ path: "README.md" });
  });

  it("keeps line numbers", () => {
    expect(fileTarget("src/App.tsx:42")).toEqual({
      path: "src/App.tsx",
      lines: [{ start: 42, end: 42 }],
    });
    expect(fileTarget("diff.ts:12-14")).toEqual({
      path: "diff.ts",
      lines: [{ start: 12, end: 14 }],
    });
  });

  it("leaves commands, prose and urls alone", () => {
    expect(fileTarget("bin/check && git status")).toBeNull();
    expect(fileTarget("npm run build")).toBeNull();
    expect(fileTarget("https://example.com/a.md")).toBeNull();
    expect(fileTarget("и/или")).toBeNull();
    expect(fileTarget("Node.js")).toBeNull();
    expect(fileTarget("v1.2.3")).toBeNull();
    expect(fileTarget("true")).toBeNull();
    expect(fileTarget("docs/")).toBeNull();
  });
});

describe("executablePath", () => {
  it("marks extensionless files under bin and scripts", () => {
    expect(executablePath("/work/app/bin/deploy")).toBe(true);
    expect(executablePath("bin/check")).toBe(true);
    expect(executablePath("/work/app/scripts/release")).toBe(true);
    expect(executablePath("/work/app/bin/deploy.sh")).toBe(false);
    expect(executablePath("docs/decisions.md")).toBe(false);
    expect(executablePath("README")).toBe(false);
  });
});

describe("previewable", () => {
  it("previews documents, pages and media, and leaves code to pero", () => {
    expect(previewable("docs/decisions.md")).toBe(true);
    expect(previewable("web/dist/index.html")).toBe(true);
    expect(previewable("shot.PNG")).toBe(true);
    expect(previewable("doc.pdf")).toBe(true);
    expect(previewable("clip.mp4")).toBe(true);
    expect(previewable("icon.svg")).toBe(true);
    expect(previewable("report.csv")).toBe(true);
    expect(previewable("query.sql")).toBe(true);
    expect(previewable("app.wasm")).toBe(true);
    expect(previewable("bin/check")).toBe(false);
    expect(previewable("src/App.tsx")).toBe(false);
    expect(previewable("notes.txt")).toBe(false);
    expect(previewable("styles.css")).toBe(false);
  });
});

describe("annotatable", () => {
  it("overlays only files with a selectable text or element", () => {
    expect(annotatable("docs/decisions.md")).toBe(true);
    expect(annotatable("page.html")).toBe(true);
    expect(annotatable("report.csv")).toBe(true);
    expect(annotatable("query.sql")).toBe(true);
    expect(annotatable("app.json")).toBe(true);
    expect(annotatable("shot.png")).toBe(false);
    expect(annotatable("doc.pdf")).toBe(false);
    expect(annotatable("app.wasm")).toBe(false);
    expect(annotatable("clip.mp4")).toBe(false);
  });
});

describe("viewHref", () => {
  it("points at the preview page and keeps the raw transport separate", () => {
    expect(viewHref("/work/app/docs/decisions.md")).toBe(
      "/view?path=%2Fwork%2Fapp%2Fdocs%2Fdecisions.md",
    );
    expect(rawHref("/work/app/docs/decisions.md")).toBe(
      "/api/view?path=%2Fwork%2Fapp%2Fdocs%2Fdecisions.md",
    );
  });

  it("carries the instance and the session into the preview", () => {
    expect(viewHref("/work/app/a.md", "laptop", "ses_1")).toBe(
      "/view?path=%2Fwork%2Fapp%2Fa.md&instance=laptop&session=ses_1",
    );
  });
});
