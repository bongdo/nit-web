import type { ReviewItem } from "./types";

export type SnoozeMap = Record<string, number>;

export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function openItems(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => item.status === "proposed" || item.status === "deferred");
}

export function visibleItems(items: ReviewItem[], snooze: SnoozeMap, now: number): ReviewItem[] {
  return openItems(items).filter((item) => (snooze[item.id] ?? 0) <= now);
}

export function pendingCount(items: ReviewItem[], snooze: SnoozeMap, now: number): number {
  return visibleItems(items, snooze, now).length;
}

export function parseSnooze(raw: string | null): SnoozeMap {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: SnoozeMap = {};
    for (const [key, until] of Object.entries(value)) {
      if (typeof until === "number" && Number.isFinite(until)) out[key] = until;
    }
    return out;
  } catch {
    return {};
  }
}

export function snoozeItem(map: SnoozeMap, id: string, now: number, days = 1): SnoozeMap {
  return { ...map, [id]: now + days * SNOOZE_MS };
}

export function ageLabel(created: number | undefined, now: number): string {
  if (!created) return "";
  const days = Math.floor((now - created * 1000) / SNOOZE_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return text;
  return text.slice(end + 4).replace(/^\s*\n/, "");
}
