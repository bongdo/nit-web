import { describe, expect, it } from "vitest";
import { activityLine, thinkingPreview, toolSummary } from "./activity";
import type { ToolPart } from "./types";

const tool = (name: string, input: unknown, status: ToolPart["state"]["status"] = "completed"): ToolPart => ({
  type: "tool",
  id: "tool_1",
  name,
  state: { status, input },
});

describe("activity", () => {
  it("describes shell commands by what they run", () => {
    expect(toolSummary(tool("shell", { command: "gofmt -w internal/server/server.go" }))).toEqual({
      verb: "Run",
      target: "gofmt -w internal/server/server.go",
    });
  });

  it("shortens paths relative to the workspace", () => {
    expect(
      toolSummary(
        tool("edit", { filePath: "/home/ubuntu/Projects/nit-gui/internal/server/server_test.go" }),
        "/home/ubuntu/Projects/nit-gui",
      ),
    ).toEqual({ verb: "Edit", target: "internal/server/server_test.go" });
  });

  it("keeps the search pattern and path together", () => {
    expect(
      toolSummary(
        tool("grep", { pattern: "NewServer", path: "/home/ubuntu/Projects/nit-gui/internal" }),
        "/home/ubuntu/Projects/nit-gui",
      ),
    ).toEqual({ verb: "Search", target: "NewServer in internal" });
  });

  it("falls back to the raw input", () => {
    expect(toolSummary(tool("custom", { value: 1 }))).toEqual({
      verb: "custom",
      target: '{"value":1}',
    });
  });

  it("previews the first line of reasoning", () => {
    expect(thinkingPreview("  first line  \nsecond line")).toBe("first line");
    expect(thinkingPreview("", 5)).toBe("");
    expect(thinkingPreview("abcdefgh", 5)).toBe("abcd…");
  });

  it("builds a live activity line", () => {
    expect(activityLine({ type: "reasoning", text: "Check the failing test\nmore" })).toBe(
      "Thinking · Check the failing test",
    );
    expect(activityLine(tool("read", { path: "/tmp/a.go" }))).toBe("Read /tmp/a.go");
  });
});
