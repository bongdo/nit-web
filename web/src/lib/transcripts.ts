import type { Message } from "./types";

const LIMIT = 5;

export class TranscriptCache {
  private entries = new Map<string, Message[]>();

  get(id: string): Message[] | undefined {
    return this.entries.get(id);
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
