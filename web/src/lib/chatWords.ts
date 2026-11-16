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

export function loadIgnoredWords(): string[] {
  return Array.from(new Set([...read(IGNORE_KEY), ...read(CHAT_KEY).map((word) => word.toLowerCase())]));
}

export function mergeChatWords(words: string[]): boolean {
  const current = read(CHAT_KEY);
  const known = new Set(current);
  if (!words.some((word) => !known.has(word.toLowerCase()))) return false;
  const merged = Array.from(new Set([...current, ...words.map((word) => word.toLowerCase())])).slice(-LIMIT);
  localStorage.setItem(CHAT_KEY, JSON.stringify(merged));
  window.dispatchEvent(new Event(SPELL_CHANGED));
  return true;
}
