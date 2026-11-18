import { getInstance } from "./api";
import { appPath } from "./base";
import { addInstanceParam } from "./instances";
import type { LineRange } from "./types";

export type FileTarget = { path: string; lines?: LineRange[] };

const EXECUTABLE_DIR = /(^|\/)(bin|sbin|scripts)\//;

export function executablePath(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return name !== "" && !name.includes(".") && EXECUTABLE_DIR.test(path);
}

export function rawHref(path: string, instance = getInstance()): string {
  return addInstanceParam(
    appPath(`/api/view?path=${encodeURIComponent(path)}`),
    instance,
  );
}

export function viewHref(path: string, instance = getInstance()): string {
  return addInstanceParam(appPath(`/view?path=${encodeURIComponent(path)}`), instance);
}

const KNOWN_EXT =
  /\.(md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|go|py|json|jsonl|ya?ml|toml|css|scss|html?|sh|bash|zsh|sql|rs|java|kt|kts|c|h|cpp|hpp|cs|rb|php|swift|xml|ini|conf|lock|mod|sum|env|svg|c3|zig|nim|str|dart|nix|lua|hs|ex|exs|erl|clj|scala|sol|vue|svelte)$/i;

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
