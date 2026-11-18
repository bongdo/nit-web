import { describe, expect, it } from "vitest";
import {
  dropSettledStatus,
  groupByDirectory,
  groupKey,
  groupSessions,
  hiddenLookup,
  hoistFinished,
  isTechnical,
  listedSessions,
  listedSubagents,
  mergeInstanceSessions,
  mergeWaitingSessionIds,
  needsResync,
  newlyRunning,
  nextSessionId,
  parseScopes,
  pollSessionIds,
  sameStatus,
  SCOPES,
  scopeSessions,
  toggleScope,
  waitingSessionIds,
  withLocalStatus,
} from "./sessions";
import type { Agent, FormInfo, Session } from "./types";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  title: "Hello",
  cost: 0,
  time: { created: 0, updated: 0 },
  location: { directory: "/home/ubuntu/project" },
  ...overrides,
});

const form = (overrides: Partial<FormInfo> = {}): FormInfo => ({
  id: "frm_1",
  sessionID: "ses_1",
  title: "Question",
  fields: [],
  ...overrides,
});

const agents: Agent[] = [
  { id: "build", name: "Build", mode: "primary", hidden: false },
  { id: "explore", name: "Explore", mode: "subagent", hidden: false },
];

describe("sessions", () => {
  it("marks children and subagent roles as technical", () => {
    expect(isTechnical(session({ parentID: "ses_0" }), agents)).toBe(true);
    expect(isTechnical(session({ agent: "explore" }), agents)).toBe(true);
    expect(isTechnical(session({ agent: "build" }), agents)).toBe(false);
  });

  it("keeps only user chats in the pool scopes", () => {
    const list = [
      session({ id: "a", agent: "build" }),
      session({ id: "b", agent: "explore" }),
      session({ id: "c", parentID: "a" }),
    ];
    expect(scopeSessions(list, "mine", agents).map((item) => item.id)).toEqual(["a"]);
    expect(scopeSessions(list, "everywhere", agents).map((item) => item.id)).toEqual(["a"]);
    expect(scopeSessions(list, "directory", agents)).toHaveLength(3);
  });

  it("labels the three scopes", () => {
    expect(SCOPES.map((item) => [item.id, item.label])).toEqual([
      ["directory", "This dir"],
      ["mine", "All chats"],
      ["everywhere", "Everywhere"],
    ]);
  });

  it("keeps enabled views in canonical order and never drops the last one", () => {
    expect(parseScopes(null)).toEqual(["directory", "mine", "everywhere"]);
    expect(parseScopes("everywhere,directory")).toEqual(["directory", "everywhere"]);
    expect(parseScopes("nonsense")).toEqual(["directory", "mine", "everywhere"]);
    expect(toggleScope(["directory", "mine", "everywhere"], "mine")).toEqual([
      "directory",
      "everywhere",
    ]);
    expect(toggleScope(["directory", "mine"], "everywhere")).toEqual([
      "directory",
      "mine",
      "everywhere",
    ]);
    expect(toggleScope(["directory"], "directory")).toEqual(["directory"]);
  });

  it("merges instance pools, tags every chat and groups per machine", () => {
    const local = session({ id: "a" });
    const remote = session({ id: "b" });
    const merged = mergeInstanceSessions([
      { instance: "frankfurt", sessions: [local] },
      { instance: "riga", sessions: [remote] },
    ]);
    expect(merged.map((item) => [item.id, item.instance])).toEqual([
      ["a", "frankfurt"],
      ["b", "riga"],
    ]);
    expect(merged[0]).not.toBe(local);
    expect(local.instance).toBeUndefined();
    const groups = groupByDirectory(groupSessions(merged));
    expect(groups.map((group) => [group.instance, group.rows.map((row) => row.session.id)])).toEqual([
      ["frankfurt", ["a"]],
      ["riga", ["b"]],
    ]);
  });

  it("lists a chat once when two instances report the same id", () => {
    const merged = mergeInstanceSessions([
      { instance: "frankfurt", sessions: [session({ id: "a" })] },
      { instance: "riga", sessions: [session({ id: "a" }), session({ id: "b" })] },
    ]);
    expect(merged.map((item) => [item.id, item.instance])).toEqual([
      ["a", "frankfurt"],
      ["b", "riga"],
    ]);
  });

  it("splits the same directory on two machines into two groups", () => {
    const rows = [
      {
        session: session({
          id: "a",
          instance: "frankfurt",
          location: { directory: "/work/nit" },
          time: { created: 0, updated: 10 },
        }),
        depth: 0,
      },
      {
        session: session({
          id: "b",
          instance: "riga",
          location: { directory: "/work/nit" },
          time: { created: 0, updated: 20 },
        }),
        depth: 0,
      },
      {
        session: session({
          id: "c",
          instance: "frankfurt",
          location: { directory: "/work/nit" },
          time: { created: 0, updated: 5 },
        }),
        depth: 0,
      },
    ];
    const groups = groupByDirectory(rows);
    expect(
      groups.map((group) => [
        group.instance,
        group.directory,
        group.rows.map((row) => row.session.id),
      ]),
    ).toEqual([
      ["riga", "/work/nit", ["b"]],
      ["frankfurt", "/work/nit", ["a", "c"]],
    ]);
    expect(new Set(groups.map(groupKey)).size).toBe(2);
  });

  it("groups chats by directory, newest project first, and ignores the selected one", () => {
    const rows = [
      { session: session({ id: "a", location: { directory: "/work/nit" }, time: { created: 0, updated: 10 } }), depth: 0 },
      { session: session({ id: "b", location: { directory: "/work/gui" }, time: { created: 0, updated: 20 } }), depth: 0 },
      { session: session({ id: "c", location: { directory: "/work/nit" }, time: { created: 0, updated: 30 } }), depth: 0 },
    ];
    expect(groupByDirectory(rows)).toEqual([
      { directory: "/work/nit", rows: [rows[0], rows[2]] },
      { directory: "/work/gui", rows: [rows[1]] },
    ]);
    expect(groupByDirectory([{ ...rows[1] }]).map((group) => group.directory)).toEqual([
      "/work/gui",
    ]);
  });

  it("hoists finished roots with their children above the remaining rows", () => {
    const rows = groupSessions(
      [
        session({ id: "done-a", location: { directory: "/work/a" }, time: { created: 0, updated: 30 } }),
        session({ id: "idle-a", location: { directory: "/work/a" }, time: { created: 0, updated: 20 } }),
        session({ id: "done-b", location: { directory: "/work/b" }, time: { created: 0, updated: 10 } }),
        session({ id: "child-b", parentID: "done-b", time: { created: 0, updated: 5 } }),
      ],
      new Set(),
      (item) => (item.id.startsWith("done") ? 0 : 1),
    );
    const split = hoistFinished(rows, (item) => item.id.startsWith("done"));
    expect(split.rest.map((row) => row.session.id)).toEqual(["idle-a"]);
    expect(split.top.map((row) => row.session.id)).toEqual(["done-a", "done-b", "child-b"]);
  });

  it("never lists subagent sessions and still honors hidden chats", () => {
    const list = [
      session({ id: "visible" }),
      session({ id: "hidden" }),
      session({ id: "child", parentID: "visible" }),
    ];
    const isHidden = hiddenLookup({ local: new Set(["hidden"]) }, "local");
    expect(listedSessions(list, isHidden, false).map((item) => item.id)).toEqual(["visible"]);
    expect(listedSessions(list, isHidden, true).map((item) => item.id)).toEqual([
      "visible",
      "hidden",
    ]);
  });

  it("lists subagents only under visible parents", () => {
    const list = [
      session({ id: "visible" }),
      session({ id: "hidden", parentID: "visible" }),
      session({ id: "child", parentID: "visible" }),
      session({ id: "orphan", parentID: "missing" }),
      session({ id: "other", parentID: "elsewhere" }),
    ];
    const isHidden = hiddenLookup({ local: new Set(["hidden"]) }, "local");
    expect(
      listedSubagents(list, new Set(["visible"]), isHidden, false).map((item) => item.id),
    ).toEqual(["child"]);
    expect(
      listedSubagents(list, new Set(["visible"]), isHidden, true).map((item) => item.id),
    ).toEqual(["hidden", "child"]);
  });

  it("keeps hidden chats per instance in the everywhere scope", () => {
    const index = {
      frankfurt: new Set(["ses_shared", "ses_local"]),
      riga: new Set(["ses_shared"]),
    };
    const isHidden = hiddenLookup(index, "frankfurt");
    const list = [
      session({ id: "ses_shared", instance: "frankfurt" }),
      session({ id: "ses_shared", instance: "riga" }),
      session({ id: "ses_local", instance: "riga" }),
      session({ id: "ses_local" }),
    ];
    expect(list.filter(isHidden).map((item) => [item.id, item.instance])).toEqual([
      ["ses_shared", "frankfurt"],
      ["ses_shared", "riga"],
      ["ses_local", undefined],
    ]);
    expect(listedSessions(list, isHidden, false).map((item) => item.id)).toEqual(["ses_local"]);
  });

  it("hides a chat only on the instance that hid it", () => {
    const isHidden = hiddenLookup({ riga: new Set(["ses_a"]) }, "frankfurt");
    expect(isHidden({ id: "ses_a", instance: "frankfurt" })).toBe(false);
    expect(isHidden({ id: "ses_a" })).toBe(false);
    expect(isHidden({ id: "ses_a", instance: "riga" })).toBe(true);
  });

  it("nests children under their parent and leaves orphans as roots", () => {
    const rows = groupSessions([
      session({ id: "parent", time: { created: 2, updated: 2 } }),
      session({ id: "child", parentID: "parent", time: { created: 1, updated: 1 } }),
      session({ id: "grandchild", parentID: "child", time: { created: 1, updated: 1 } }),
      session({ id: "orphan", parentID: "missing", time: { created: 0, updated: 0 } }),
    ]);
    expect(rows.map((row) => [row.session.id, row.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
      ["grandchild", 2],
      ["orphan", 0],
    ]);
  });

  it("cycles through sessions and wraps at both ends", () => {
    const list = [session({ id: "a" }), session({ id: "b" }), session({ id: "c" })];
    expect(nextSessionId(list, "a", 1)).toBe("b");
    expect(nextSessionId(list, "c", 1)).toBe("a");
    expect(nextSessionId(list, "a", -1)).toBe("c");
    expect(nextSessionId(list, null, 1)).toBe("a");
    expect(nextSessionId(list, null, -1)).toBe("c");
    expect(nextSessionId([], "a", 1)).toBeNull();
  });

  it("collects waiting sessions from forms with a selected-session fallback", () => {
    expect([
      ...waitingSessionIds([
        form(),
        form({ id: "frm_2", sessionID: "ses_2" }),
        form({ id: "frm_3", sessionID: "ses_1" }),
      ]),
    ]).toEqual(["ses_1", "ses_2"]);
    expect([...waitingSessionIds([form({ sessionID: "" })], "ses_selected")]).toEqual([
      "ses_selected",
    ]);
    expect([...waitingSessionIds([form({ sessionID: "" })])]).toEqual([]);
  });

  it("raises waiting sessions first within roots and children", () => {
    const rows = groupSessions(
      [
        session({ id: "parent", time: { created: 3, updated: 3 } }),
        session({ id: "child", parentID: "parent", time: { created: 2, updated: 2 } }),
        session({ id: "waiting-child", parentID: "parent", time: { created: 1, updated: 1 } }),
        session({ id: "root", time: { created: 0, updated: 0 } }),
        session({ id: "waiting-root", time: { created: 0, updated: 0 } }),
      ],
      new Set(["waiting-root", "waiting-child"]),
    );
    expect(rows.map((row) => row.session.id)).toEqual([
      "waiting-root",
      "parent",
      "waiting-child",
      "child",
      "root",
    ]);
  });

  it("orders roots and children by supplied rank, then by recency", () => {
    const rows = groupSessions(
      [
        session({ id: "idle-old", time: { created: 0, updated: 10 } }),
        session({ id: "running-new", time: { created: 0, updated: 40 } }),
        session({ id: "done-new", time: { created: 0, updated: 50 } }),
        session({ id: "done-old", time: { created: 0, updated: 20 } }),
        session({ id: "parent", time: { created: 0, updated: 15 } }),
        session({ id: "child-idle", parentID: "parent", time: { created: 0, updated: 6 } }),
        session({ id: "child-running", parentID: "parent", time: { created: 0, updated: 7 } }),
      ],
      new Set(),
      (item) => {
        if (item.id === "done-new" || item.id === "done-old") return 0;
        if (item.id === "running-new" || item.id === "child-running") return 2;
        return 1;
      },
    );
    expect(rows.map((row) => row.session.id)).toEqual([
      "done-new",
      "done-old",
      "parent",
      "child-idle",
      "child-running",
      "idle-old",
      "running-new",
    ]);
  });

  it("merges background waiting ids without leaking them into the selected forms queue", () => {
    expect([
      ...mergeWaitingSessionIds(
        "ses_1",
        [form({ sessionID: "ses_1" })],
        new Set(["ses_1", "ses_2"]),
      ),
    ]).toEqual(["ses_2", "ses_1"]);
    expect([
      ...mergeWaitingSessionIds("ses_1", [], new Set(["ses_1", "ses_2"])),
    ]).toEqual(["ses_2"]);
    expect([
      ...mergeWaitingSessionIds("ses_1", [form({ sessionID: "ses_2" })], new Set()),
    ]).toEqual(["ses_2"]);
  });

  it("keeps statuses changed here over a stale server snapshot", () => {
    const server = { done: new Set(["a"]), failed: new Set<string>() };
    const local = { done: new Set(["b"]), failed: new Set(["c"]) };

    expect([...withLocalStatus(server, local, new Set(["b"])).done]).toEqual(["a", "b"]);
    expect(withLocalStatus(server, local, new Set(["c"])).failed.has("c")).toBe(true);
    expect(withLocalStatus(server, local, new Set(["a"])).done.has("a")).toBe(false);
    expect(withLocalStatus(server, local, new Set())).toBe(server);
    expect(sameStatus(server, { done: new Set(["a"]), failed: new Set() })).toBe(true);
    expect(sameStatus(server, local)).toBe(false);
  });

  it("stops overriding the server once it echoes the local status", () => {
    const local = { done: new Set(["b"]), failed: new Set(["c"]) };
    const stale = { done: new Set<string>(), failed: new Set<string>() };
    const pending = new Set(["b", "c"]);

    dropSettledStatus(stale, local, pending);
    expect([...pending]).toEqual(["b", "c"]);

    dropSettledStatus({ done: new Set(["b"]), failed: new Set<string>() }, local, pending);
    expect([...pending]).toEqual(["c"]);

    dropSettledStatus({ done: new Set(["b"]), failed: new Set(["c"]) }, local, pending);
    expect([...pending]).toEqual([]);
  });

  it("reports each session only when it starts running", () => {
    const seen: Record<string, boolean> = {};
    const idle = session({ id: "idle" });
    const busy = session({ id: "busy", time: { created: 0, updated: 0, busy: 2, idle: 1 } });

    expect(newlyRunning([busy, idle], {}, seen)).toEqual(["busy"]);
    expect(newlyRunning([busy, idle], {}, seen)).toEqual([]);
    expect(newlyRunning([busy, idle], { idle: true }, seen)).toEqual(["idle"]);
    expect(newlyRunning([busy, idle], { busy: false }, seen)).toEqual([]);
    expect(newlyRunning([busy, idle], {}, seen)).toEqual(["busy"]);
  });

  it("polls only unselected running or already-waiting sessions", () => {
    const list = [
      session({ id: "selected", time: { created: 0, updated: 0, busy: 2, idle: 1 } }),
      session({ id: "busy", time: { created: 0, updated: 0, busy: 2, idle: 1 } }),
      session({ id: "idle", time: { created: 0, updated: 0, busy: 1, idle: 2 } }),
      session({ id: "waiting", time: { created: 0, updated: 0 } }),
      session({ id: "forced-idle", time: { created: 0, updated: 0, busy: 2, idle: 1 } }),
    ];
    expect(
      pollSessionIds(
        list,
        "selected",
        { selected: true, "forced-idle": false },
        new Set(["selected", "waiting"]),
      ),
    ).toEqual(["busy", "waiting"]);
  });

  it("asks for a resync when a running session goes quiet", () => {
    expect(needsResync(true, 1_000, 15_999)).toBe(false);
    expect(needsResync(true, 1_000, 16_000)).toBe(true);
    expect(needsResync(false, 1_000, 60_000)).toBe(false);
    expect(needsResync(undefined, 1_000, 60_000)).toBe(false);
    expect(needsResync(true, undefined, 60_000)).toBe(false);
  });
});
