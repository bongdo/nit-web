import type { ReasoningPart, ToolPart } from "./types";

const verbs: Record<string, string> = {
  bash: "Run",
  shell: "Run",
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "Edit",
  patch: "Patch",
  grep: "Search",
  glob: "Find",
  list: "List",
  ls: "List",
  task: "Task",
  webfetch: "Fetch",
  websearch: "Search",
  todowrite: "Plan",
  todoread: "Plan",
  skill: "Skill",
  question: "Ask",
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? oneLine(value) : "";
}

function recordOf(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function shortPath(path: string, cwd?: string | null): string {
  const root = cwd?.replace(/\/+$/, "");
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function fallbackInput(input: unknown): string {
  if (typeof input === "string") return oneLine(input).slice(0, 100);
  if (!input || typeof input !== "object") return "";
  try {
    return JSON.stringify(input).slice(0, 100);
  } catch {
    return "";
  }
}

export function toolSummary(
  part: ToolPart,
  cwd?: string | null,
): { verb: string; target: string } {
  const input = recordOf(part.state.input);
  const command = stringValue(input.command);
  const file = stringValue(input.filePath ?? input.file_path ?? input.path);
  const pattern = stringValue(input.pattern);
  const query = stringValue(input.query ?? input.search);
  const url = stringValue(input.url);
  const fallback = stringValue(input.description ?? input.prompt ?? input.name ?? input.skill);
  const target =
    command ||
    (pattern ? (file ? `${pattern} in ${shortPath(file, cwd)}` : pattern) : "") ||
    (file ? shortPath(file, cwd) : "") ||
    query ||
    url ||
    fallback ||
    fallbackInput(part.state.input);

  return { verb: verbs[part.name] ?? part.name, target };
}

export function thinkingPreview(text: string, max = 90): string {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function activityLine(
  part: ReasoningPart | ToolPart,
  cwd?: string | null,
): string {
  if (part.type === "reasoning") {
    const preview = thinkingPreview(part.text);
    return preview ? `Thinking · ${preview}` : "Thinking";
  }
  const { verb, target } = toolSummary(part, cwd);
  return target ? `${verb} ${target}` : verb;
}
