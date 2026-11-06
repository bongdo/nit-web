import type { Message } from "./types";

const LIMIT = 5;

export class TranscriptCache {
  private entries = new Map<string, Message[]>();

  get(id: string): Message[] | undefined {
    const value = this.entries.get(id);
    if (value !== undefined) {
      this.entries.delete(id);
      this.entries.set(id, value);
    }
    return value;
  }

  set(id: string, messages: Message[]) {
    this.entries.delete(id);
    this.entries.set(id, messages);
    while (this.entries.size > LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(id: string) {
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
  }
}
