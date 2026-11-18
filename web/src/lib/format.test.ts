import { describe, expect, it } from "vitest";
import {
  basename,
  workspaceLabel,
  contextPercent,
  estimateCost,
  fileUri,
  filterSessions,
  formatCost,
  formatRelative,
  formatTokens,
  mergeRunningStates,
  modelKey,
  modelLabel,
  quoteText,
  replyText,
  sessionRunning,
  turnBlocks,
} from "./format";
import type { Message, Model, Part, Session } from "./types";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  title: "Hello",
  cost: 0,
  time: { created: 0, updated: 0 },
  location: { directory: "/home/ubuntu/project" },
  ...overrides,
});

describe("format", () => {
  it("reads a file uri from the flat and the v2 source shape", () => {
    expect(fileUri({ uri: "file:///tmp/a.png" })).toBe("file:///tmp/a.png");
    expect(fileUri({ source: { uri: "file:///tmp/b.png" }, name: "b.png" })).toBe(
      "file:///tmp/b.png",
    );
    expect(fileUri({ name: "c.png" })).toBeUndefined();
  });

  it("formats relative time", () => {
    const now = 10 * 60_000;
    expect(formatRelative(now, now)).toBe("now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelative(now - 3 * 60 * 60_000, now)).toBe("3h");
    expect(formatRelative(now - 2 * 24 * 60 * 60_000, now)).toBe("2d");
  });

  it("formats costs and tokens", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("formats model refs", () => {
    const models = [
      { id: "m1", providerID: "p1", name: "Model One" },
    ] as Model[];
    expect(modelKey({ id: "m1", providerID: "p1" })).toBe("p1/m1");
    expect(modelLabel({ id: "m1", providerID: "p1" }, models)).toBe("Model One");
    expect(modelLabel({ id: "m1", providerID: "p1", variant: "high" }, models)).toBe(
      "Model One · high",
    );
    expect(modelLabel({ id: "m2", providerID: "p2" }, models)).toBe("p2/m2");
  });

  it("estimates cost and context from tokens", () => {
    const model = {
      cost: [{ input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } }],
      limit: { context: 1_000_000 },
    } as unknown as Model;
    const tokens = {
      input: 1_000_000,
      output: 1_000_000,
      reasoning: 500_000,
      cache: { read: 1_000_000 },
    };
    expect(estimateCost(tokens, model)).toBeCloseTo(1.053, 6);
    expect(contextPercent(tokens, model)).toBe(100);
    expect(estimateCost(undefined, model)).toBe(0);
  });

  it("picks the context price tier from the last request, not session totals", () => {
    const model = {
      cost: [
        { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
        {
          tier: { type: "context", size: 100_000 },
          input: 0.5,
          output: 2.5,
          cache: { read: 0.05, write: 0.625 },
        },
      ],
      limit: { context: 1_000_000 },
    } as unknown as Model;
    const totals = { input: 50_000, output: 100_000, cache: { read: 60_000, write: 0 } };
    const small = { input: 40_000, output: 10, cache: { read: 50_000, write: 0 } };
    expect(estimateCost(totals, model, small)).toBeCloseTo(0.0556, 6);
    expect(estimateCost(totals, model, { input: 100_000 })).toBeCloseTo(0.0556, 6);
    expect(estimateCost(totals, model, totals)).toBeCloseTo(0.278, 6);
  });

  it("joins assistant text parts and ignores reasoning and tool parts", () => {
    const message: Message = {
      id: "msg_1",
      type: "assistant",
      time: { created: 0 },
      content: [
        { type: "text", text: "# Heading\n\nA sentence." },
        { type: "reasoning", text: "hidden" },
        { type: "tool", id: "t1", name: "bash", state: { status: "completed" } },
        { type: "text", text: "```ts\nconst x = 1;\n```" },
      ],
    };
    expect(replyText(message)).toBe("# Heading\n\nA sentence.\n\n```ts\nconst x = 1;\n```");
  });

  it("keeps assistant text and questions in transcript order", () => {
    const content: Part[] = [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "Before the question." },
      { type: "tool", id: "q1", name: "question", state: { status: "completed" } },
      { type: "text", text: "After the answer." },
    ];
    expect(turnBlocks(content).map((block) => block.kind)).toEqual([
      "text",
      "question",
      "text",
    ]);
  });

  it("refreshes running sessions unless a newer local event arrived", () => {
    const requestedAt = 5_000;
    const idle = session({ id: "ses_1", time: { created: 1, updated: 2, busy: 3, idle: 4 } });
    const busy = session({ id: "ses_2", time: { created: 1, updated: 2, busy: 3 } });
    const merge = (localEvents: Record<string, number>) =>
      mergeRunningStates(
        { ses_1: true, ses_2: false, ses_stale: true },
        [idle, busy],
        localEvents,
        requestedAt,
      );

    expect(merge({})).toEqual({ ses_1: false, ses_2: true, ses_stale: true });
    expect(merge({ ses_1: requestedAt + 1, ses_2: requestedAt + 1 })).toEqual({
      ses_1: true,
      ses_2: false,
      ses_stale: true,
    });
    expect(merge({ ses_1: requestedAt - 1 })).toEqual({
      ses_1: false,
      ses_2: true,
      ses_stale: true,
    });
  });

  it("detects running sessions", () => {
    expect(sessionRunning(session({ time: { created: 1, updated: 2 } }))).toBe(false);
    expect(sessionRunning(session({ time: { created: 1, updated: 2, busy: 3 } }))).toBe(true);
    expect(
      sessionRunning(session({ time: { created: 1, updated: 2, busy: 3, idle: 4 } })),
    ).toBe(false);
  });

  it("filters by title, directory and id", () => {
    const items = [
      session({ id: "ses_a", title: "Alpha" }),
      session({ id: "ses_b", title: "Beta", location: { directory: "/work/gamma" } }),
    ];
    expect(filterSessions(items, "alpha")).toHaveLength(1);
    expect(filterSessions(items, "gamma")).toHaveLength(1);
    expect(filterSessions(items, "ses_")).toHaveLength(2);
    expect(filterSessions(items, "")).toHaveLength(2);
  });

  it("keeps content matches by their snippet", () => {
    const items = [
      session({ id: "ses_a", title: "Alpha" }),
      session({ id: "ses_b", title: "Beta", snippet: "…правили Sheets.kt…" }),
    ];
    expect(filterSessions(items, "sheets.kt")).toHaveLength(1);
    expect(filterSessions(items, "sheets.kt")[0].id).toBe("ses_b");
  });

  it("takes the last path segment", () => {
    expect(basename("/home/ubuntu/project/")).toBe("project");
    expect(basename("/")).toBe("/");
    expect(basename(undefined)).toBe("");
    expect(workspaceLabel("/")).toBe("Root");
    expect(workspaceLabel("/tmp")).toBe("Temp");
    expect(workspaceLabel("/home/ubuntu/project/")).toBe("project");
  });

  it("turns a selection into a markdown quote", () => {
    expect(quoteText("  hello\n\nworld  ")).toBe("> hello\n>\n> world");
  });
});
