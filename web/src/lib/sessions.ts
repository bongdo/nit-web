import { sessionRunning } from "./format";
import type { Agent, FormInfo, Session } from "./types";

export type Scope = "directory" | "mine" | "everywhere";

export const SCOPES: { id: Scope; label: string }[] = [
  { id: "directory", label: "This dir" },
  { id: "mine", label: "All chats" },
  { id: "everywhere", label: "Everywhere" },
];

export function parseScopes(raw: string | null): Scope[] {
  const ids = new Set((raw ?? "").split(",").filter(Boolean));
  const picked = SCOPES.filter((item) => ids.has(item.id)).map((item) => item.id);
  return picked.length > 0 ? picked : SCOPES.map((item) => item.id);
}

export function toggleScope(active: Scope[], id: Scope): Scope[] {
  const on = active.includes(id);
  if (on && active.length === 1) return active;
  const next = new Set(active);
  if (on) next.delete(id);
  else next.add(id);
  return SCOPES.filter((item) => next.has(item.id)).map((item) => item.id);
}

export function isTechnical(session: Session, agents: Agent[]): boolean {
  if (session.parentID) return true;
  const agent = agents.find((item) => item.id === session.agent);
  return Boolean(agent && (agent.hidden || agent.mode === "subagent"));
}

export function scopeSessions(sessions: Session[], scope: Scope, agents: Agent[]): Session[] {
  if (scope === "directory") return sessions;
  return sessions.filter((session) => !isTechnical(session, agents));
}

export type InstanceSessions = { instance: string; sessions: Session[] };

export type InstanceHidden = { instance: string; hidden: string[] };

export type HiddenIndex = Record<string, ReadonlySet<string>>;

export const NO_HIDDEN: ReadonlySet<string> = new Set();

export function hiddenIndex(pools: InstanceHidden[]): HiddenIndex {
  const index: HiddenIndex = {};
  for (const pool of pools) {
    const ids = new Set(index[pool.instance]);
    for (const id of pool.hidden) ids.add(id);
    index[pool.instance] = ids;
  }
  return index;
}

export function hiddenLookup(index: HiddenIndex, active: string) {
  return (session: Pick<Session, "id" | "instance">) =>
    (index[session.instance ?? active] ?? NO_HIDDEN).has(session.id);
}

// shortcut: a session id seen twice keeps the first instance, revisit if two instances can really share one.
export function mergeInstanceSessions(pools: InstanceSessions[]): Session[] {
  const seen = new Set<string>();
  const merged: Session[] = [];
  for (const { instance, sessions } of pools) {
    for (const session of sessions) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      merged.push({ ...session, instance });
    }
  }
  return merged;
}

export function listedSessions(
  sessions: Session[],
  isHidden: (session: Pick<Session, "id" | "instance">) => boolean,
  showHidden: boolean,
): Session[] {
  return sessions.filter(
    (session) => !session.parentID && (showHidden || !isHidden(session)),
  );
}

export function listedSubagents(
  sessions: Session[],
  parentIds: ReadonlySet<string>,
  isHidden: (session: Pick<Session, "id" | "instance">) => boolean,
  showHidden: boolean,
): Session[] {
  return sessions.filter(
    (session) =>
      Boolean(session.parentID && parentIds.has(session.parentID)) &&
      (showHidden || !isHidden(session)),
  );
}

export function waitingSessionIds(forms: FormInfo[], fallbackId?: string | null): Set<string> {
  const ids = new Set<string>();
  for (const form of forms) {
    const id = form.sessionID || fallbackId;
    if (id) ids.add(id);
  }
  return ids;
}

export function mergeWaitingSessionIds(
  selectedId: string | null,
  selectedForms: FormInfo[],
  background: ReadonlySet<string>,
): Set<string> {
  const ids = new Set(background);
  if (selectedId) ids.delete(selectedId);
  for (const id of waitingSessionIds(selectedForms, selectedId)) ids.add(id);
  return ids;
}

export function pollSessionIds(
  sessions: Session[],
  selectedId: string | null,
  running: Record<string, boolean>,
  waiting: ReadonlySet<string>,
): string[] {
  return sessions
    .filter((session) => session.id !== selectedId)
    .filter(
      (session) => (running[session.id] ?? sessionRunning(session)) || waiting.has(session.id),
    )
    .map((session) => session.id);
}

export function newlyRunning(
  sessions: Session[],
  running: Record<string, boolean>,
  seen: Record<string, boolean>,
): string[] {
  const ids: string[] = [];
  for (const session of sessions) {
    const active = running[session.id] ?? sessionRunning(session);
    if (active && !seen[session.id]) ids.push(session.id);
    seen[session.id] = active;
  }
  return ids;
}

export type SessionRow = { session: Session; depth: number };

export type SessionGroup = { directory: string; instance?: string; rows: SessionRow[] };

export function hoistFinished(
  rows: SessionRow[],
  finished: (session: Session) => boolean,
): { top: SessionRow[]; rest: SessionRow[] } {
  const top: SessionRow[] = [];
  const rest: SessionRow[] = [];
  let inTop = false;
  for (const row of rows) {
    if (row.depth === 0) inTop = finished(row.session);
    (inTop ? top : rest).push(row);
  }
  return { top, rest };
}

export function groupByDirectory(rows: SessionRow[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const row of rows) {
    const directory = row.session.location?.directory ?? "";
    const instance = row.session.instance;
    const key = `${instance ?? ""}\u0000${directory}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { directory, instance, rows: [row] });
  }
  const updated = (group: SessionGroup) =>
    Math.max(...group.rows.map((row) => row.session.time.updated));
  return Array.from(groups.values()).sort(
    (a, b) =>
      updated(b) - updated(a) ||
      a.directory.localeCompare(b.directory) ||
      (a.instance ?? "").localeCompare(b.instance ?? ""),
  );
}

export function groupKey(group: SessionGroup): string {
  return `${group.instance ?? ""}\u0000${group.directory}`;
}

export function nextSessionId(
  sessions: Session[],
  currentId: string | null,
  step: 1 | -1,
): string | null {
  if (sessions.length === 0) return null;
  const index = sessions.findIndex((session) => session.id === currentId);
  const start = index === -1 ? (step === 1 ? -1 : 0) : index;
  return sessions[(start + step + sessions.length) % sessions.length]?.id ?? null;
}

export function groupSessions(
  sessions: Session[],
  waiting: ReadonlySet<string> = new Set(),
  rank?: (session: Session) => number,
): SessionRow[] {
  const ids = new Set(sessions.map((session) => session.id));
  const children = new Map<string, Session[]>();
  const roots: Session[] = [];
  for (const session of sessions) {
    if (session.parentID && ids.has(session.parentID)) {
      const list = children.get(session.parentID) ?? [];
      list.push(session);
      children.set(session.parentID, list);
    } else {
      roots.push(session);
    }
  }
  const sort = (list: Session[]) =>
    [...list].sort((a, b) => {
      if (rank) return rank(a) - rank(b) || b.time.updated - a.time.updated;
      return Number(waiting.has(b.id)) - Number(waiting.has(a.id));
    });
  const rows: SessionRow[] = [];
  const walk = (session: Session, depth: number) => {
    rows.push({ session, depth });
    for (const child of sort(children.get(session.id) ?? [])) walk(child, depth + 1);
  };
  for (const root of sort(roots)) walk(root, 0);
  return rows;
}
