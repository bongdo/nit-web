import { describe, expect, it } from "vitest";
import {
  groupByDirectory,
  groupSessions,
  isTechnical,
  listedSessions,
  listedSubagents,
  mergeWaitingSessionIds,
  newlyRunning,
  nextSessionId,
  pollSessionIds,
  RECENT_WINDOW_MS,
  scopeSessions,
  splitByRecency,
  waitingSessionIds,
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

  it("keeps only user chats in the mine scope", () => {
    const list = [
      session({ id: "a", agent: "build" }),
      session({ id: "b", agent: "explore" }),
      session({ id: "c", parentID: "a" }),
    ];
    expect(scopeSessions(list, "mine", agents).map((item) => item.id)).toEqual(["a"]);
    expect(scopeSessions(list, "directory", agents)).toHaveLength(3);
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

  it("never lists subagent sessions and still honors hidden chats", () => {
    const list = [
      session({ id: "visible" }),
      session({ id: "hidden" }),
      session({ id: "child", parentID: "visible" }),
    ];
    expect(listedSessions(list, new Set(["hidden"]), false).map((item) => item.id)).toEqual([
      "visible",
    ]);
    expect(listedSessions(list, new Set(["hidden"]), true).map((item) => item.id)).toEqual([
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
    expect(
      listedSubagents(list, new Set(["visible"]), new Set(["hidden"]), false).map(
        (item) => item.id,
      ),
    ).toEqual(["child"]);
    expect(
      listedSubagents(list, new Set(["visible"]), new Set(["hidden"]), true).map(
        (item) => item.id,
      ),
    ).toEqual(["hidden", "child"]);
  });

  it("keeps every chat when the scope has ten or fewer", () => {
    const now = 1_000_000_000_000;
    const list = Array.from({ length: 10 }, (_, index) =>
      session({ id: `s${index}`, time: { created: 0, updated: 0 } }),
    );
    const split = splitByRecency(list, new Set(), now);
    expect(split.recent.map((item) => item.id)).toEqual(list.map((item) => item.id));
    expect(split.older).toEqual([]);
  });

  it("moves chats older than twelve hours behind the older list unless kept", () => {
    const now = 1_000_000_000_000;
    const recent = Array.from({ length: 6 }, (_, index) =>
      session({
        id: `r${index}`,
        time: { created: 0, updated: now - index * 1000 },
      }),
    );
    const older = Array.from({ length: 5 }, (_, index) =>
      session({
        id: `o${index}`,
        time: { created: 0, updated: now - RECENT_WINDOW_MS - 1000 - index },
      }),
    );
    const split = splitByRecency([...recent, ...older], new Set(["o4"]), now);
    expect(split.recent.map((item) => item.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "o4"]);
    expect(split.older.map((item) => item.id)).toEqual(["o0", "o1", "o2", "o3"]);
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
});
