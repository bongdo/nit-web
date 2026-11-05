export type SpellLanguage = "ru" | "en" | "mixed";

export type SpellIssue = {
  start: number;
  end: number;
  word: string;
  suggestions: string[];
  language: SpellLanguage;
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
  "сабагент",
  "сабагенты",
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
  /(?:~|\.{1,2})?\/[\p{L}\p{N}_.@+{}:-]+(?:\/[\p{L}\p{N}_.@+{}:-]+)+/gu;
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
    .replace(/`[^`\n]*`/g, blank)
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
  return [{ start, end, word, suggestions, language }];
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
