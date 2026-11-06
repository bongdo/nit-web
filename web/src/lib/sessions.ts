import type { Agent, FormInfo, Session } from "./types";

export type Scope = "directory" | "mine" | "all";

export const SCOPES: { id: Scope; label: string }[] = [
  { id: "directory", label: "This dir" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
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

export function waitingSessionIds(forms: FormInfo[], fallbackId?: string | null): Set<string> {
  const ids = new Set<string>();
  for (const form of forms) {
    const id = form.sessionID || fallbackId;
    if (id) ids.add(id);
  }
  return ids;
}

export type SessionRow = { session: Session; depth: number };

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
  const waitingFirst = (list: Session[]) =>
    [...list].sort((a, b) => Number(waiting.has(b.id)) - Number(waiting.has(a.id)));
  const rows: SessionRow[] = [];
  const walk = (session: Session, depth: number) => {
    rows.push({ session, depth });
    for (const child of waitingFirst(children.get(session.id) ?? [])) walk(child, depth + 1);
  };
  for (const root of waitingFirst(roots)) walk(root, 0);
  return rows;
}
