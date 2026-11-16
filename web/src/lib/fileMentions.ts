import type { LineRange } from "./types";

export type FileMention = { path: string; lines?: LineRange[] };

const maxLength = 300;

export function fileMention(raw: string): FileMention | null {
  const text = raw.trim();
  if (!text || text.length > maxLength) return null;
  if (/\s/.test(text) || text.includes("://") || text.startsWith("~")) return null;
  const suffix = /^(.*?):(\d+)(?:-(\d+))?$/.exec(text);
  const path = suffix ? suffix[1] : text;
  if (!path.includes("/") || path.endsWith("/") || path.startsWith("-")) return null;
  if (!suffix) return { path };
  const start = Number(suffix[2]);
  return { path, lines: [{ start, end: Number(suffix[3] ?? start) }] };
}
