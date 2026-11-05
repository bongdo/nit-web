import { describe, expect, it } from "vitest";
import { groupSessions, isTechnical, scopeSessions } from "./sessions";
import type { Agent, Session } from "./types";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  title: "Hello",
  cost: 0,
  time: { created: 0, updated: 0 },
  location: { directory: "/home/ubuntu/project" },
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
    expect(scopeSessions(list, "all", agents)).toHaveLength(3);
  });

  it("nests children under their parent and leaves orphans as roots", () => {
    const rows = groupSessions([
      session({ id: "parent", time: { created: 2, updated: 2 } }),
      session({ id: "child", parentID: "parent", time: { created: 1, updated: 1 } }),
      session({ id: "orphan", parentID: "missing", time: { created: 0, updated: 0 } }),
    ]);
    expect(rows.map((row) => [row.session.id, row.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
      ["orphan", 0],
    ]);
  });
});
