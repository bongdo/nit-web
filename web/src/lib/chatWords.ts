import type { Message } from "./types";

export const SPELL_CHANGED = "nit-gui-spell-changed";

const IGNORE_KEY = "nit-gui.spell-ignore";
const CHAT_KEY = "nit-gui.spell-chat";
const LIMIT = 4000;
const MAX_CHARS = 20_000;

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function write(key: string, words: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(words));
  } catch {
    return;
  }
}

function lower(words: string[]): string[] {
  return words.map((word) => word.toLowerCase());
}

export function chatText(messages: Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type === "user" && message.text) parts.push(message.text);
    if (message.type === "assistant") {
      for (const part of message.content ?? []) {
        if (part.type === "text" && part.text) parts.push(part.text);
      }
    }
  }
  return parts.join("\n").slice(-MAX_CHARS);
}

export function ignoreWords(words: string[]): string[] {
  const clean = words.map((word) => word.trim().toLowerCase()).filter(Boolean);
  const merged = Array.from(new Set([...lower(read(IGNORE_KEY)), ...clean]));
  write(IGNORE_KEY, merged);
  return merged;
}

export function loadIgnoredWords(): string[] {
  return Array.from(new Set([...lower(read(IGNORE_KEY)), ...lower(read(CHAT_KEY))]));
}

export function mergeChatWords(words: string[]): boolean {
  const current = read(CHAT_KEY);
  const known = new Set(lower(current));
  if (!words.some((word) => !known.has(word.toLowerCase()))) return false;
  write(CHAT_KEY, Array.from(new Set([...current, ...lower(words)])).slice(-LIMIT));
  window.dispatchEvent(new Event(SPELL_CHANGED));
  return true;
}
