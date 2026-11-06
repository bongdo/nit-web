import { describe, expect, it } from "vitest";
import { mergeTail, mergeTranscript, prependMessages, TranscriptCache } from "./transcripts";
import type { Message } from "./types";

const messages = (id: string): Message[] => [
  { id, type: "user", time: { created: 1 }, text: id },
];

const transcript = (id: string, previous: string | null = null) => ({
  messages: messages(id),
  previous,
  complete: previous === null,
});

describe("TranscriptCache", () => {
  it("evicts by total size", () => {
    const cache = new TranscriptCache(10, 10);
    cache.set("ses_1", transcript("msg_1"), 6);
    cache.set("ses_2", transcript("msg_2"), 6);
    expect(cache.get("ses_1")).toBeUndefined();
    expect(cache.get("ses_2")?.messages).toEqual(messages("msg_2"));
  });

  it("keeps a bounded number of entries when asked", () => {
    const cache = new TranscriptCache(1000, 2);
    cache.set("ses_1", transcript("msg_1"), 1);
    cache.set("ses_2", transcript("msg_2"), 1);
    cache.set("ses_3", transcript("msg_3"), 1);
    expect(cache.get("ses_1")).toBeUndefined();
    expect(cache.get("ses_3")).toBeDefined();
  });

  it("does not cap the entry count by default", () => {
    const cache = new TranscriptCache(1000);
    for (let index = 0; index < 40; index += 1) {
      cache.set(`ses_${index}`, transcript(`msg_${index}`), 1);
    }
    expect(cache.get("ses_0")).toBeDefined();
    expect(cache.get("ses_39")).toBeDefined();
  });

  it("treats only a transcript without an older cursor as complete", () => {
    const cache = new TranscriptCache();
    expect(cache.isComplete("ses_1")).toBe(false);
    cache.set("ses_1", transcript("msg_1", "older"));
    expect(cache.isComplete("ses_1")).toBe(false);
    cache.set("ses_2", transcript("msg_2"));
    expect(cache.isComplete("ses_2")).toBe(true);
    cache.set("ses_3", { messages: messages("msg_3"), previous: null, complete: false });
    expect(cache.isComplete("ses_3")).toBe(false);
  });

  it("refreshes recency on read", () => {
    const cache = new TranscriptCache(10, 10);
    cache.set("ses_1", transcript("msg_1"), 5);
    cache.set("ses_2", transcript("msg_2"), 5);
    cache.get("ses_1");
    cache.set("ses_3", transcript("msg_3"), 5);
    expect(cache.get("ses_2")).toBeUndefined();
    expect(cache.get("ses_1")).toBeDefined();
  });

  it("keeps the older-page cursor", () => {
    const cache = new TranscriptCache();
    cache.set("ses_1", transcript("msg_1", "older"));
    expect(cache.get("ses_1")?.previous).toBe("older");
  });

  it("skips a transcript larger than the budget", () => {
    const cache = new TranscriptCache(5, 10);
    cache.set("ses_1", transcript("msg_1"), 6);
    expect(cache.get("ses_1")).toBeUndefined();
  });

  it("adds the event size on update", () => {
    const cache = new TranscriptCache(10, 10);
    cache.set("ses_1", transcript("msg_1"), 6);
    cache.update("ses_1", messages("msg_2"), 5);
    expect(cache.get("ses_1")).toBeUndefined();
  });

  it("drops a deleted transcript", () => {
    const cache = new TranscriptCache();
    cache.set("ses_1", transcript("msg_1"));
    cache.delete("ses_1");
    expect(cache.get("ses_1")).toBeUndefined();
  });
});

describe("transcript merging", () => {
  it("replaces the tail and keeps older pages", () => {
    const old = { id: "msg_1", type: "user", time: { created: 1 }, text: "old" } as Message;
    const replaced = { id: "msg_2", type: "assistant", time: { created: 2 } } as Message;
    const optimistic = { id: "local-1", type: "user", time: { created: 3 } } as Message;
    const tailMessage = { id: "msg_2", type: "assistant", time: { created: 2 }, text: "new" } as Message;
    const next = { id: "msg_3", type: "assistant", time: { created: 4 } } as Message;

    expect(mergeTail([old, replaced, optimistic], [tailMessage, next])).toEqual([
      old,
      tailMessage,
      next,
    ]);
  });

  it("merges a full transcript with newer cached messages", () => {
    const first = { id: "m1", type: "user", time: { created: 1 }, text: "old" } as Message;
    const second = { id: "m2", type: "assistant", time: { created: 2 }, text: "old" } as Message;
    const third = { id: "m3", type: "assistant", time: { created: 3 }, text: "new" } as Message;
    const updated = { ...second, text: "updated" };
    const local = { id: "local-1", type: "user", time: { created: 4 }, text: "local" } as Message;

    expect(mergeTranscript([first, second, third], [updated, local])).toEqual([
      first,
      updated,
      third,
      local,
    ]);
  });

  it("prepends older messages without duplicates", () => {
    const existing = [{ id: "m3" }, { id: "m4" }] as Message[];
    const older = [{ id: "m1" }, { id: "m2" }, { id: "m3" }] as Message[];
    expect(prependMessages(existing, older).map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });
});
