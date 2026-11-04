import type { Model, ModelRef, Session, Tokens } from "./types";

export function formatRelative(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatCost(cost?: number): string {
  if (cost === undefined || Number.isNaN(cost) || cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(n?: number): string {
  if (!n) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function tokenTotal(tokens?: Tokens): number {
  if (!tokens) return 0;
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0)
  );
}

export function modelKey(model?: ModelRef | null): string {
  if (!model) return "";
  return `${model.providerID}/${model.id}`;
}

export function modelLabel(model: ModelRef | null | undefined, models: Model[]): string {
  if (!model) return "";
  const found = models.find((m) => m.id === model.id && m.providerID === model.providerID);
  return found?.name ?? `${model.providerID}/${model.id}`;
}

export function basename(path?: string): string {
  if (!path) return "";
  const clean = path.replace(/\/+$/, "");
  if (clean === "") return "/";
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) || "/" : clean;
}

export function sessionRunning(session?: Session | null): boolean {
  if (!session) return false;
  const { busy, idle } = session.time;
  if (!busy) return false;
  return !idle || busy > idle;
}

export function filterSessions(sessions: Session[], query: string): Session[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) =>
    `${s.title ?? ""} ${s.location?.directory ?? ""} ${s.id}`.toLowerCase().includes(q),
  );
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
