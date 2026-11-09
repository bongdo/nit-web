import { describe, expect, it } from "vitest";
import {
  editedFiles,
  mergeFiles,
  patchAddedLines,
  peroHref,
  resolveFilePath,
  termHref,
  turnEditedFiles,
} from "./diff";
import type { Message, ToolPart } from "./types";

const tool = (overrides: Partial<ToolPart> = {}): ToolPart => ({
  type: "tool",
  id: "t1",
  name: "edit",
  state: { status: "completed" },
  ...overrides,
});

describe("editedFiles", () => {
  it("reads file patches from edit metadata", () => {
    const part = tool({
      state: {
        status: "completed",
        metadata: {
          files: [
            { file: "/src/a.go", status: "modified", additions: 2, deletions: 1 },
            { file: "/src/b.go", status: "added", additions: 5, deletions: 0 },
          ],
        },
      },
    });
    expect(editedFiles(part)).toEqual([
      { path: "/src/a.go", status: "modified", additions: 2, deletions: 1 },
      { path: "/src/b.go", status: "added", additions: 5, deletions: 0 },
    ]);
  });

  it("falls back to the input path for writes", () => {
    const part = tool({
      name: "write",
      state: { status: "completed", input: { path: "/src/new.txt", content: "x" } },
    });
    expect(editedFiles(part)).toEqual([{ path: "/src/new.txt" }]);
  });

  it("keeps the added lines from the patch", () => {
    const part = tool({
      state: {
        status: "completed",
        metadata: {
          files: [
            {
              file: "/src/a.ts",
              additions: 2,
              deletions: 1,
              patch: "@@ -1,2 +4,3 @@\n-old\n context\n+first\n+second",
            },
          ],
        },
      },
    });
    expect(editedFiles(part)).toEqual([
      {
        path: "/src/a.ts",
        status: undefined,
        additions: 2,
        deletions: 1,
        lines: [{ start: 5, end: 6 }],
      },
    ]);
  });

  it("ignores reads and shell commands", () => {
    expect(
      editedFiles(tool({ name: "read", state: { status: "completed", input: { path: "/x" } } })),
    ).toEqual([]);
    expect(
      editedFiles(
        tool({ name: "shell", state: { status: "completed", input: { command: "ls" } } }),
      ),
    ).toEqual([]);
  });
});

describe("patchAddedLines", () => {
  const patch = [
    "Index: /src/a.ts",
    "===================================================================",
    "--- /src/a.ts",
    "+++ /src/a.ts",
    "@@ -1,3 +10,4 @@",
    " context",
    "+added 11",
    "+added 12",
    "-old",
    " context",
    "@@ -20,0 +30,1 @@",
    "+new",
  ].join("\n");

  it("maps patch additions to new line numbers", () => {
    expect(patchAddedLines(patch)).toEqual([
      { start: 11, end: 12 },
      { start: 30, end: 30 },
    ]);
  });

  it("points at the hunk when it only removes lines", () => {
    expect(patchAddedLines("@@ -1,2 +8,0 @@\n-a\n-b")).toEqual([{ start: 8, end: 8 }]);
  });

  it("ignores non-patch metadata", () => {
    expect(patchAddedLines(undefined)).toEqual([]);
    expect(patchAddedLines("not a patch")).toEqual([]);
  });
});

describe("mergeFiles", () => {
  it("dedupes by path and sums changes", () => {
    expect(
      mergeFiles([
        { path: "/a", additions: 1, deletions: 0, lines: [{ start: 1, end: 2 }] },
        { path: "/b", additions: 2, deletions: 1 },
        { path: "/a", additions: 3, deletions: 2, status: "modified", lines: [{ start: 2, end: 3 }, { start: 9, end: 9 }] },
      ]),
    ).toEqual([
      {
        path: "/a",
        status: "modified",
        additions: 4,
        deletions: 2,
        lines: [{ start: 1, end: 3 }, { start: 9, end: 9 }],
      },
      {
        path: "/b",
        status: undefined,
        additions: 2,
        deletions: 1,
        lines: undefined,
      },
    ]);
  });
});

describe("turnEditedFiles", () => {
  it("uses cached markers while steps are not loaded", () => {
    const messages: Message[] = [
      {
        id: "m1",
        type: "assistant",
        time: { created: 1 },
        steps: 2,
        content: [{ type: "text", text: "done" }],
        edited: [{ path: "/a", additions: 2 }],
      },
    ];
    expect(turnEditedFiles(messages)).toEqual([{ path: "/a", additions: 2 }]);
  });

  it("prefers loaded tool parts over stale markers", () => {
    const messages: Message[] = [
      {
        id: "m1",
        type: "assistant",
        time: { created: 1 },
        steps: 1,
        edited: [{ path: "/a", additions: 99 }],
        content: [
          tool({
            state: {
              status: "completed",
              metadata: { files: [{ file: "/a", additions: 3, deletions: 1 }] },
            },
          }),
        ],
      },
    ];
    expect(turnEditedFiles(messages)).toEqual([
      { path: "/a", status: undefined, additions: 3, deletions: 1 },
    ]);
  });

  it("merges files from light and loaded messages", () => {
    const messages: Message[] = [
      {
        id: "m1",
        type: "assistant",
        time: { created: 1 },
        steps: 1,
        content: [{ type: "text", text: "done" }],
        edited: [{ path: "/a", additions: 2 }],
      },
      {
        id: "m2",
        type: "assistant",
        time: { created: 2 },
        steps: 2,
        content: [
          { type: "reasoning", text: "thinking", ordinal: 0 },
          tool({
            state: {
              status: "completed",
              metadata: { files: [{ file: "/b", additions: 1 }] },
            },
          }),
        ],
      },
    ];
    expect(turnEditedFiles(messages)).toEqual([
      { path: "/a", additions: 2 },
      { path: "/b", status: undefined, additions: 1, deletions: undefined },
    ]);
  });
});

describe("resolveFilePath", () => {
  it("joins relative paths to the workspace", () => {
    expect(resolveFilePath("web/src/a.ts", "/home/me/project")).toBe(
      "/home/me/project/web/src/a.ts",
    );
    expect(resolveFilePath("./web/src/a.ts", "/home/me/project/")).toBe(
      "/home/me/project/web/src/a.ts",
    );
    expect(resolveFilePath("../other/a.ts", "/home/me/project")).toBe(
      "/home/me/other/a.ts",
    );
  });

  it("leaves absolute paths alone", () => {
    expect(resolveFilePath("/home/me/project/a.ts", "/other")).toBe(
      "/home/me/project/a.ts",
    );
  });
});

describe("peroHref", () => {
  it("appends the open path to the base", () => {
    expect(peroHref("/pero/", "/home/me/a b.go")).toBe(
      "/pero/?open=%2Fhome%2Fme%2Fa%20b.go",
    );
    expect(peroHref("/pero", "/a")).toBe("/pero/?open=%2Fa");
  });

  it("passes added lines and the agent", () => {
    expect(
      peroHref(
        "/pero",
        "/a",
        [
          { start: 12, end: 14 },
          { start: 20, end: 20 },
        ],
        "Build",
      ),
    ).toBe("/pero/?open=%2Fa&lines=12-14%2C20&agent=Build");
  });
});

describe("termHref", () => {
  it("appends the directory to the base", () => {
    expect(termHref("/term/", "/home/me/Projects/nit-gui")).toBe(
      "/term/?dir=%2Fhome%2Fme%2FProjects%2Fnit-gui",
    );
    expect(termHref("/term", "/a")).toBe("/term/?dir=%2Fa");
  });
});
