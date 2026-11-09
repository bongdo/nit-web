import { describe, expect, it } from "vitest";
import { editedFiles, mergeFiles, peroHref, termHref, turnEditedFiles } from "./diff";
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

describe("mergeFiles", () => {
  it("dedupes by path and sums changes", () => {
    expect(
      mergeFiles([
        { path: "/a", additions: 1, deletions: 0 },
        { path: "/b", additions: 2, deletions: 1 },
        { path: "/a", additions: 3, deletions: 2, status: "modified" },
      ]),
    ).toEqual([
      { path: "/a", status: "modified", additions: 4, deletions: 2 },
      { path: "/b", status: undefined, additions: 2, deletions: 1 },
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

describe("peroHref", () => {
  it("appends the open path to the base", () => {
    expect(peroHref("/pero/", "/home/me/a b.go")).toBe(
      "/pero/?open=%2Fhome%2Fme%2Fa%20b.go",
    );
    expect(peroHref("/pero", "/a")).toBe("/pero/?open=%2Fa");
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
