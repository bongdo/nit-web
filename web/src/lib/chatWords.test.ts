import { describe, expect, it } from "vitest";
import { chatText } from "./chatWords";
import type { Message } from "./types";

function message(patch: Partial<Message>): Message {
  return { id: `m${Math.random()}`, type: "assistant", time: { created: 0 }, ...patch };
}

describe("chatText", () => {
  it("keeps user text and assistant prose but not reasoning or tool output", () => {
    const text = chatText([
      message({ type: "user", text: "привет" }),
      message({
        content: [
          { type: "text", text: "ответ" },
          { type: "reasoning", text: "размышление" },
          {
            type: "tool",
            id: "tool",
            name: "bash",
            state: { status: "completed", content: [{ type: "text", text: "output" }] },
          },
        ],
      }),
      message({ type: "compaction" }),
    ]);
    expect(text).toBe("привет\nответ");
  });

  it("keeps only the tail of a long chat", () => {
    const text = chatText([message({ type: "user", text: "a".repeat(30_000) + "tail" })]);
    expect(text.length).toBe(20_000);
    expect(text.endsWith("tail")).toBe(true);
  });
});
