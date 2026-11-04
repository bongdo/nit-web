import { describe, expect, it } from "vitest";
import {
  basename,
  filterSessions,
  formatCost,
  formatRelative,
  formatTokens,
  mergeRunningStates,
  modelKey,
  modelLabel,
  sessionRunning,
} from "./format";
import type { Model, Session } from "./types";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  title: "Hello",
  cost: 0,
  time: { created: 0, updated: 0 },
  location: { directory: "/home/ubuntu/project" },
  ...overrides,
});

describe("format", () => {
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

  it("takes the last path segment", () => {
    expect(basename("/home/ubuntu/project/")).toBe("project");
    expect(basename("/")).toBe("/");
    expect(basename(undefined)).toBe("");
  });
});
