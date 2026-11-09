import type { EditedFile, LineRange, Message, ToolPart } from "./types";

const writers = new Set(["write", "edit", "multiedit", "patch"]);

function pushLine(ranges: LineRange[], line: number): void {
  const last = ranges[ranges.length - 1];
  if (last && line <= last.end + 1) {
    last.end = Math.max(last.end, line);
    return;
  }
  ranges.push({ start: line, end: line });
}

export function patchAddedLines(patch: unknown): LineRange[] {
  if (typeof patch !== "string") return [];
  const ranges: LineRange[] = [];
  let line = 0;
  let firstHunk = 0;
  let inHunk = false;
  for (const row of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      line = Number(hunk[1]);
      if (!firstHunk) firstHunk = line;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (row.startsWith("+")) {
      pushLine(ranges, line);
      line += 1;
    } else if (row.startsWith(" ")) {
      line += 1;
    }
  }
  if (ranges.length === 0 && firstHunk > 0) return [{ start: firstHunk, end: firstHunk }];
  return ranges;
}

function mergeLines(left?: LineRange[], right?: LineRange[]): LineRange[] | undefined {
  const all = [...(left ?? []), ...(right ?? [])];
  if (all.length === 0) return undefined;
  all.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: LineRange[] = [];
  for (const range of all) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function editedFiles(part: ToolPart): EditedFile[] {
  const meta = record(part.state.metadata);
  const raw = Array.isArray(meta.files) ? meta.files : [];
  const files: EditedFile[] = [];
  for (const item of raw) {
    const entry = record(item);
    const path =
      typeof entry.file === "string"
        ? entry.file
        : typeof entry.path === "string"
          ? entry.path
          : "";
    if (!path) continue;
    const lines = patchAddedLines(entry.patch);
    files.push({
      path,
      status: typeof entry.status === "string" ? entry.status : undefined,
      additions: typeof entry.additions === "number" ? entry.additions : undefined,
      deletions: typeof entry.deletions === "number" ? entry.deletions : undefined,
      lines: lines.length > 0 ? lines : undefined,
    });
  }
  if (files.length > 0) return files;
  if (!writers.has(part.name)) return [];
  const input = record(part.state.input);
  const single = [input.path, input.filePath, input.file_path].find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  return single ? [{ path: single }] : [];
}

export function mergeFiles(files: EditedFile[]): EditedFile[] {
  const seen = new Map<string, EditedFile>();
  for (const file of files) {
    const current = seen.get(file.path);
    if (!current) {
      seen.set(file.path, { ...file });
      continue;
    }
    const sum = (left?: number, right?: number) =>
      left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
    seen.set(file.path, {
      path: file.path,
      status: file.status ?? current.status,
      additions: sum(current.additions, file.additions),
      deletions: sum(current.deletions, file.deletions),
      lines: mergeLines(current.lines, file.lines),
    });
  }
  return [...seen.values()];
}

export function turnEditedFiles(messages: Message[]): EditedFile[] {
  const files: EditedFile[] = [];
  for (const message of messages) {
    const content = message.content ?? [];
    const loaded = content.some(
      (part) =>
        part.type === "reasoning" ||
        (part.type === "tool" && part.name !== "question"),
    );
    if (!loaded) {
      files.push(...(message.edited ?? []));
      continue;
    }
    for (const part of content) {
      if (part.type === "tool") files.push(...editedFiles(part));
    }
  }
  return mergeFiles(files);
}

export function resolveFilePath(path: string, cwd?: string | null): string {
  if (path.startsWith("/")) return path;
  const root = cwd?.trim();
  if (!root || !root.startsWith("/")) return path;
  const parts = `${root}/${path}`.split("/");
  const clean: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      clean.pop();
      continue;
    }
    clean.push(part);
  }
  return `/${clean.join("/")}`;
}

export function formatLineRanges(lines?: LineRange[]): string {
  if (!lines?.length) return "";
  return lines
    .map((line) => (line.start === line.end ? `${line.start}` : `${line.start}-${line.end}`))
    .join(",");
}

function withQuery(base: string, key: string, value: string): string {
  const url = base.endsWith("/") ? base : `${base}/`;
  return `${url}?${key}=${encodeURIComponent(value)}`;
}

export function peroHref(
  base: string,
  path: string,
  lines?: LineRange[],
  agent?: string,
): string {
  let href = withQuery(base, "open", path);
  const ranges = formatLineRanges(lines);
  if (ranges) href += `&lines=${encodeURIComponent(ranges)}`;
  if (agent) href += `&agent=${encodeURIComponent(agent)}`;
  return href;
}

export function termHref(base: string, dir: string): string {
  return withQuery(base, "dir", dir);
}
