import { describe, expect, it } from "vitest";
import { TranscriptCache } from "./transcripts";
import type { Message } from "./types";

const messages = (id: string): Message[] => [
  { id, type: "user", time: { created: 1 }, text: id },
];

describe("TranscriptCache", () => {
  it("keeps the last five transcripts", () => {
    const cache = new TranscriptCache();
    for (let index = 1; index <= 6; index += 1) {
      cache.set(`ses_${index}`, messages(`msg_${index}`));
    }
    expect(cache.get("ses_1")).toBeUndefined();
    expect(cache.get("ses_2")).toEqual(messages("msg_2"));
    expect(cache.get("ses_6")).toEqual(messages("msg_6"));
  });

  it("refreshes recency on write", () => {
    const cache = new TranscriptCache();
    for (let index = 1; index <= 5; index += 1) {
      cache.set(`ses_${index}`, messages(`msg_${index}`));
    }
    cache.set("ses_1", messages("msg_1"));
    cache.set("ses_6", messages("msg_6"));
    expect(cache.get("ses_2")).toBeUndefined();
    expect(cache.get("ses_1")).toBeDefined();
  });

  it("drops a deleted transcript", () => {
    const cache = new TranscriptCache();
    cache.set("ses_1", messages("msg_1"));
    cache.delete("ses_1");
    expect(cache.get("ses_1")).toBeUndefined();
  });
});
