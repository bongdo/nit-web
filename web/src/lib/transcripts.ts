import type { Message } from "./types";

const MAX_BYTES = 12 << 20;
const MAX_ENTRIES = 30;

export type CachedTranscript = {
  messages: Message[];
  previous: string | null;
};

type Entry = CachedTranscript & { bytes: number };

export class TranscriptCache {
  private entries = new Map<string, Entry>();
  private total = 0;

  constructor(
    private maxBytes = MAX_BYTES,
    private maxEntries = MAX_ENTRIES,
  ) {}

  get(id: string): CachedTranscript | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  set(
    id: string,
    transcript: CachedTranscript,
    bytes = estimateTranscriptSize(transcript.messages),
  ) {
    this.delete(id);
    if (bytes > this.maxBytes) return;
    this.entries.set(id, { ...transcript, bytes });
    this.total += bytes;
    this.trim();
  }

  update(id: string, messages: Message[], deltaBytes: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.delete(id);
    const bytes = entry.bytes + Math.max(0, deltaBytes);
    if (bytes > this.maxBytes) return;
    this.entries.set(id, { messages, previous: entry.previous, bytes });
    this.total += bytes;
    this.trim();
  }

  delete(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.total -= entry.bytes;
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
    this.total = 0;
  }

  private trim() {
    while (this.total > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

export function estimateTranscriptSize(messages: Message[]): number {
  return JSON.stringify(messages).length;
}

export function mergeTail(existing: Message[], tail: Message[]): Message[] {
  const tailIds = new Set(tail.map((message) => message.id));
  const base = existing.filter(
    (message) => !message.id.startsWith("local-") && !tailIds.has(message.id),
  );
  return [...base, ...tail];
}

export function prependMessages(existing: Message[], older: Message[]): Message[] {
  const ids = new Set(existing.map((message) => message.id));
  return [...older.filter((message) => !ids.has(message.id)), ...existing];
}
