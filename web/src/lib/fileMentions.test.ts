import { describe, expect, it } from "vitest";
import { fileMention } from "./fileMentions";

describe("fileMention", () => {
  it("takes a relative path with a directory", () => {
    expect(fileMention("etc/searxng/settings.yml")).toEqual({ path: "etc/searxng/settings.yml" });
    expect(fileMention(" bin/check ")).toEqual({ path: "bin/check" });
    expect(fileMention("./src/App.tsx")).toEqual({ path: "./src/App.tsx" });
    expect(fileMention("/home/ubuntu/Projects/nit-gui/AGENTS.md")).toEqual({
      path: "/home/ubuntu/Projects/nit-gui/AGENTS.md",
    });
  });

  it("reads a line or a line range", () => {
    expect(fileMention("src/main.go:12")).toEqual({
      path: "src/main.go",
      lines: [{ start: 12, end: 12 }],
    });
    expect(fileMention("src/main.go:12-20")).toEqual({
      path: "src/main.go",
      lines: [{ start: 12, end: 20 }],
    });
  });

  it("ignores what is not a path", () => {
    expect(fileMention("main.go")).toBeNull();
    expect(fileMention("https://example.com/a/b")).toBeNull();
    expect(fileMention("a b/c")).toBeNull();
    expect(fileMention("dir/sub/")).toBeNull();
    expect(fileMention("~/Projects/nit")).toBeNull();
  });
});
