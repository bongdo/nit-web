import type { EditedFile, Message, ToolPart } from "./types";

const writers = new Set(["write", "edit", "multiedit", "patch"]);

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
    files.push({
      path,
      status: typeof entry.status === "string" ? entry.status : undefined,
      additions: typeof entry.additions === "number" ? entry.additions : undefined,
      deletions: typeof entry.deletions === "number" ? entry.deletions : undefined,
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

function withQuery(base: string, key: string, value: string): string {
  const url = base.endsWith("/") ? base : `${base}/`;
  return `${url}?${key}=${encodeURIComponent(value)}`;
}

export function peroHref(base: string, path: string): string {
  return withQuery(base, "open", path);
}

export function termHref(base: string, dir: string): string {
  return withQuery(base, "dir", dir);
}
