export type SpellLanguage = "ru" | "en" | "mixed";

export type SpellIssue = {
  start: number;
  end: number;
  word: string;
  suggestions: string[];
  language: SpellLanguage;
  source?: "spell" | "grammar";
  message?: string;
};

export type GrammarMatch = {
  offset: number;
  length: number;
  message: string;
  ruleID: string;
  replacements: string[];
};

export type SpellChecker = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

const ALLOWED = new Set([
  "api",
  "agent",
  "agents",
  "backend",
  "bash",
  "bin",
  "claude",
  "cli",
  "codeblock",
  "composer",
  "css",
  "csrf",
  "csp",
  "db",
  "deepseek",
  "deploy",
  "dictionaries",
  "dictionary",
  "direnv",
  "dist",
  "emacs",
  "event",
  "events",
  "fish",
  "fork",
  "free",
  "frontend",
  "gemini",
  "git",
  "github",
  "gitlab",
  "glm",
  "go",
  "gofmt",
  "golang",
  "gpt",
  "gui",
  "haiku",
  "html",
  "http",
  "https",
  "hunspell",
  "ide",
  "iframe",
  "javascript",
  "jj",
  "json",
  "jsx",
  "jwt",
  "kimi",
  "languagetool",
  "lucide",
  "markdown",
  "mcp",
  "message",
  "messages",
  "minimax",
  "model",
  "models",
  "nano",
  "neovim",
  "nix",
  "nixos",
  "node",
  "npm",
  "npx",
  "nspell",
  "oauth",
  "opencode",
  "opus",
  "pty",
  "qwen",
  "radix",
  "react",
  "readme",
  "reasoning",
  "run",
  "sandbox",
  "save",
  "session",
  "sessions",
  "shadcn",
  "shots",
  "sonnet",
  "spec",
  "spellcheck",
  "sse",
  "ssh",
  "src",
  "srcdoc",
  "stt",
  "stream",
  "streaming",
  "subagent",
  "subagents",
  "synthetic",
  "systemd",
  "tailwind",
  "textarea",
  "token",
  "tokens",
  "toml",
  "toolcall",
  "transcript",
  "tsx",
  "tts",
  "tui",
  "typescript",
  "uri",
  "url",
  "utf",
  "vcs",
  "vim",
  "vite",
  "vitest",
  "vscode",
  "wav",
  "web",
  "webhook",
  "websocket",
  "whisper",
  "workspace",
  "workspaces",
  "xss",
  "yaml",
  "zsh",
  "композер",
  "композера",
  "композере",
  "композеру",
  "опенкод",
  "промпт",
  "промпта",
  "промптов",
  "промпты",
  "промт",
  "субагент",
  "субагента",
  "субагентам",
  "субагентами",
  "субагентах",
  "субагенте",
  "субагентом",
  "субагенты",
  "субагентов",
  "токен",
  "токенов",
  "токены",
  "воркспейс",
  "nit",
  "nit-gui",
  "nitgui",
]);

const FILE =
  /\b[\p{L}\p{N}_.-]+\.(?:tsx?|jsx?|json|md|css|html?|go|py|rs|sh|toml|ya?ml|lock|txt|png|jpe?g|gif|svg|wav|mp3|pdf|zip|gz)\b/giu;
const PATH =
  /(?:~|\.{1,2})?\/[\p{L}\p{N}_.@+{}:-]+|[\p{L}\p{N}_.@+-]+\/[\p{L}\p{N}_.@+{}:/-]+/gu;
const EMAIL = /[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*/gu;
const ALL_CAPS_LATIN = /^[A-Z]{2,6}$/;
const DIGIT_OR_UNDERSCORE = /[\p{N}_]/u;

function blank(value: string): string {
  return " ".repeat(value.length);
}

export function maskCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/```[\s\S]*$/g, blank)
    .replace(/~~~[\s\S]*$/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/`[^`\n]*$/gm, blank)
    .replace(/<\/?[\p{L}][^>]*>/gu, blank)
    .replace(URL, blank)
    .replace(EMAIL, blank)
    .replace(PATH, blank)
    .replace(FILE, blank)
    .replace(/(^|\s)--[\p{L}\p{N}][\p{L}\p{N}-]*/gu, (match, lead: string) => lead + blank(match.slice(lead.length)))
    .replace(/(^|\s)[#@][\p{L}\p{N}_-]+/gu, (match, lead: string) => lead + blank(match.slice(lead.length)));
}

export function words(text: string): { start: number; end: number; value: string }[] {
  const masked = maskCode(text);
  const result: { start: number; end: number; value: string }[] = [];
  for (const match of masked.matchAll(WORD)) {
    const start = match.index ?? 0;
    result.push({ start, end: start + match[0].length, value: text.slice(start, start + match[0].length) });
  }
  return result;
}

export function languageOf(word: string): SpellLanguage | null {
  const cyrillic = /\p{Script=Cyrillic}/u.test(word);
  const latin = /\p{Script=Latin}/u.test(word);
  if (cyrillic && latin) return "mixed";
  if (cyrillic) return "ru";
  if (latin) return "en";
  return null;
}

export function allowedWord(word: string): boolean {
  if (ALLOWED.has(word.toLowerCase())) return true;
  return ALL_CAPS_LATIN.test(word);
}

function skippable(word: string): boolean {
  if (word.length > 64) return true;
  if (DIGIT_OR_UNDERSCORE.test(word)) return true;
  return allowedWord(word);
}

function checkPart(
  word: string,
  start: number,
  end: number,
  ru: SpellChecker,
  en: SpellChecker,
  ignore: Set<string>,
): SpellIssue[] {
  if (skippable(word) || ignore.has(word.toLowerCase())) return [];
  const language = languageOf(word);
  if (!language) return [];
  const primary = language === "en" ? en : ru;
  if (primary.correct(word)) return [];
  if (language === "mixed" && en.correct(word)) return [];
  const suggestions = Array.from(new Set(primary.suggest(word)))
    .filter((item) => item.toLowerCase() !== word.toLowerCase())
    .slice(0, 5);
  return [{ start, end, word, suggestions, language, source: "spell" }];
}

export function findIssues(
  text: string,
  ru: SpellChecker,
  en: SpellChecker,
  ignore: Set<string> = new Set(),
): SpellIssue[] {
  const issues: SpellIssue[] = [];
  for (const token of words(text)) {
    if (skippable(token.value)) continue;
    if (token.value.includes("-")) {
      let start = token.start;
      for (const part of token.value.split("-")) {
        issues.push(...checkPart(part, start, start + part.length, ru, en, ignore));
        start += part.length + 1;
      }
      continue;
    }
    issues.push(...checkPart(token.value, token.start, token.end, ru, en, ignore));
  }
  return issues.sort((left, right) => left.start - right.start);
}

export function applyIssue(text: string, issue: SpellIssue, replacement: string): string {
  return text.slice(0, issue.start) + replacement + text.slice(issue.end);
}

export function issueKey(issue: SpellIssue): string {
  return `${issue.start}:${issue.end}:${issue.word}`;
}

export function issueAtCaret(
  issues: SpellIssue[],
  caret: number | null,
  text = "",
): SpellIssue | null {
  if (caret === null) return null;
  for (const issue of issues) {
    if (caret >= issue.start && caret <= issue.end) return issue;
    if (
      text &&
      caret === issue.end + 1 &&
      (caret >= text.length || /\s/.test(text[caret]))
    ) {
      return issue;
    }
  }
  return null;
}

export function grammarIssues(text: string, matches: GrammarMatch[]): SpellIssue[] {
  const result: SpellIssue[] = [];
  for (const match of matches) {
    const start = Math.max(0, match.offset);
    const end = Math.min(text.length, start + match.length);
    if (end <= start) continue;
    const word = text.slice(start, end);
    const suggestions = Array.from(new Set(match.replacements))
      .filter((item) => item.trim() && item !== word)
      .slice(0, 5);
    if (suggestions.length === 0) continue;
    result.push({
      start,
      end,
      word,
      suggestions,
      language: languageOf(word) ?? "en",
      source: "grammar",
      message: match.message,
    });
  }
  return result;
}

export function mergeIssues(spelling: SpellIssue[], grammar: SpellIssue[]): SpellIssue[] {
  const result = [...spelling];
  for (const issue of grammar) {
    if (result.some((existing) => existing.start < issue.end && issue.start < existing.end)) continue;
    result.push(issue);
  }
  return result.sort((left, right) => left.start - right.start || right.end - left.end);
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function safeAutoFix(word: string, suggestions: string[]): string | null {
  if (word.length < 4 || word.includes("-") || word !== word.toLowerCase()) return null;
  const lower = word.toLowerCase();
  const candidates = Array.from(new Set(suggestions))
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== lower)
    .filter((item) => levenshtein(lower, item.toLowerCase()) === 1);
  return candidates.length === 1 ? candidates[0] : null;
}

export function maskedAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  return maskCode(text)[index] === " " && text[index] !== " ";
}

export function keepStale(previous: string, next: string, issues: SpellIssue[]): SpellIssue[] {
  const max = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < max && previous[prefix] === next[prefix]) prefix += 1;
  return issues.filter((issue) => issue.end <= prefix);
}
