import { sessionRunning } from "./format";
import type { Agent, FormInfo, Session } from "./types";

export type Scope = "directory" | "mine";

export const SCOPES: { id: Scope; label: string }[] = [
  { id: "directory", label: "This project" },
  { id: "mine", label: "All chats" },
];

export function isTechnical(session: Session, agents: Agent[]): boolean {
  if (session.parentID) return true;
  const agent = agents.find((item) => item.id === session.agent);
  return Boolean(agent && (agent.hidden || agent.mode === "subagent"));
}

export function scopeSessions(sessions: Session[], scope: Scope, agents: Agent[]): Session[] {
  if (scope !== "mine") return sessions;
  return sessions.filter((session) => !isTechnical(session, agents));
}

export function listedSessions(
  sessions: Session[],
  hiddenIds: ReadonlySet<string>,
  showHidden: boolean,
): Session[] {
  return sessions.filter(
    (session) => !session.parentID && (showHidden || !hiddenIds.has(session.id)),
  );
}

export function listedSubagents(
  sessions: Session[],
  parentIds: ReadonlySet<string>,
  hiddenIds: ReadonlySet<string>,
  showHidden: boolean,
): Session[] {
  return sessions.filter(
    (session) =>
      Boolean(session.parentID && parentIds.has(session.parentID)) &&
      (showHidden || !hiddenIds.has(session.id)),
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

export type SessionGroup = { directory: string; rows: SessionRow[] };

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
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const directory = row.session.location?.directory ?? "";
    const list = groups.get(directory);
    if (list) list.push(row);
    else groups.set(directory, [row]);
  }
  const updated = (list: SessionRow[]) => Math.max(...list.map((row) => row.session.time.updated));
  return Array.from(groups, ([directory, list]) => ({ directory, rows: list })).sort(
    (a, b) => updated(b.rows) - updated(a.rows) || a.directory.localeCompare(b.directory),
  );
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
