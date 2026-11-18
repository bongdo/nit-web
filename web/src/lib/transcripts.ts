import type { Message } from "./types";

const MAX_BYTES = 12 << 20;

export type CachedTranscript = {
  messages: Message[];
  previous: string | null;
  complete?: boolean;
};

type Entry = CachedTranscript & { bytes: number };

export class TranscriptCache {
  private entries = new Map<string, Entry>();
  private total = 0;

  constructor(
    private maxBytes = MAX_BYTES,
    private maxEntries = Number.POSITIVE_INFINITY,
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

  isComplete(id: string): boolean {
    return this.entries.get(id)?.complete === true;
  }

  update(id: string, messages: Message[], deltaBytes: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.delete(id);
    const bytes = entry.bytes + Math.max(0, deltaBytes);
    if (bytes > this.maxBytes) return;
    this.entries.set(id, {
      messages,
      previous: entry.previous,
      complete: entry.complete,
      bytes,
    });
    this.total += bytes;
    this.trim();
  }

  delete(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.total -= entry.bytes;
    this.entries.delete(id);
  }

  clear(prefix = "") {
    for (const key of [...this.entries.keys()]) {
      if (prefix && !key.startsWith(prefix)) continue;
      this.delete(key);
    }
  }

  private trim() {
    while (this.total > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

export class ScopedTranscriptCache {
  constructor(
    private scope: string,
    private base: TranscriptCache,
  ) {}

  private key(id: string): string {
    return `${this.scope}\u0000${id}`;
  }

  get(id: string): CachedTranscript | undefined {
    return this.base.get(this.key(id));
  }

  set(id: string, transcript: CachedTranscript, bytes?: number) {
    this.base.set(this.key(id), transcript, bytes);
  }

  update(id: string, messages: Message[], deltaBytes: number) {
    this.base.update(this.key(id), messages, deltaBytes);
  }

  delete(id: string) {
    this.base.delete(this.key(id));
  }

  isComplete(id: string): boolean {
    return this.base.isComplete(this.key(id));
  }

  clear() {
    this.base.clear(`${this.scope}\u0000`);
  }

  getFor(instance: string, id: string): CachedTranscript | undefined {
    return this.base.get(`${instance}\u0000${id}`);
  }

  setFor(instance: string, id: string, transcript: CachedTranscript) {
    this.base.set(`${instance}\u0000${id}`, transcript);
  }

  updateFor(instance: string, id: string, messages: Message[], deltaBytes: number) {
    this.base.update(`${instance}\u0000${id}`, messages, deltaBytes);
  }

  deleteFor(instance: string, id: string) {
    this.base.delete(`${instance}\u0000${id}`);
  }
}

export const sharedTranscripts = new TranscriptCache();

export function estimateTranscriptSize(messages: Message[]): number {
  return JSON.stringify(messages).length;
}

export const TAIL_TURNS = 8;
export const TAIL_BYTES = 400 * 1024;

export function userTurns(messages: Message[]): number {
  let turns = 0;
  for (const message of messages) {
    if (message.type === "user") turns += 1;
  }
  return turns;
}

export function tailNeedsMore(
  messages: Message[],
  bytes: number,
  previous: string | null,
): boolean {
  if (!previous || bytes >= TAIL_BYTES) return false;
  return userTurns(messages) < TAIL_TURNS;
}

export function mergeTail(existing: Message[], tail: Message[]): Message[] {
  const tailIds = new Set(tail.map((message) => message.id));
  const base = existing.filter(
    (message) => !message.id.startsWith("local-") && !tailIds.has(message.id),
  );
  return [...base, ...tail];
}

export function mergeSnapshot(snapshot: Message[], current: Message[]): Message[] {
  const ids = new Set(snapshot.map((message) => message.id));
  const extra = current.filter(
    (message) => !message.id.startsWith("local-") && !ids.has(message.id),
  );
  return extra.length > 0 ? [...snapshot, ...extra] : snapshot;
}

function assistantText(message: Message): number {
  if (message.type !== "assistant") return 0;
  const parts = message.content ?? [];
  let length = 0;
  for (const part of parts) {
    if (part.type === "text") length += part.text.length;
  }
  return length;
}

export function preferLocal(snapshot: Message[], local: Message[]): Message[] {
  const serverText = new Map(snapshot.map((message) => [message.id, assistantText(message)]));
  return local.filter(
    (message) => assistantText(message) >= (serverText.get(message.id) ?? 0),
  );
}

export function prependMessages(existing: Message[], older: Message[]): Message[] {
  const ids = new Set(existing.map((message) => message.id));
  return [...older.filter((message) => !ids.has(message.id)), ...existing];
}
