import type { LineRange } from "./types";

export type FileTarget = { path: string; lines?: LineRange[] };

const KNOWN_EXT =
  /\.(md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|go|py|json|jsonl|ya?ml|toml|css|scss|html?|sh|bash|zsh|sql|rs|java|kt|kts|c|h|cpp|hpp|cs|rb|php|swift|xml|ini|conf|lock|mod|sum|env|svg)$/i;

const PATH_CHARS = /^[A-Za-z0-9_.@+-]+$/;
const LINE_SUFFIX = /^(.*):(\d{1,6})(?:-(\d{1,6}))?$/;

export function fileTarget(raw: string): FileTarget | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  if (text.startsWith("~") || text.includes(".." + "/..")) return null;

  const match = LINE_SUFFIX.exec(text);
  const path = match ? match[1]! : text;
  if (/\/$/.test(path)) return null;

  const segments = path.split("/").filter((segment) => segment !== "." && segment !== "");
  if (segments.length === 0) return null;
  if (!segments.every((segment) => PATH_CHARS.test(segment) && segment !== "..")) return null;

  if (segments.length === 1) {
    const name = segments[0]!;
    if (!KNOWN_EXT.test(name)) return null;
    const stem = name.slice(0, name.lastIndexOf("."));
    const plain = /^[a-z0-9_.@+-]+$/.test(stem) || /^[A-Z0-9_.@+-]+$/.test(stem);
    if (!plain) return null;
  }

  if (!match) return { path };
  const start = Number(match[2]);
  const end = Number(match[3] ?? match[2]);
  if (!start || end < start) return { path };
  return { path, lines: [{ start, end }] };
}
