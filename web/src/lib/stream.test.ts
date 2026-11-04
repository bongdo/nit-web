import { describe, expect, it } from "vitest";
import { applyEvent, normalizeMessages } from "./stream";
import type { Message, StreamEvent, ToolPart } from "./types";

function event(type: string, data: Record<string, unknown>, created = 1_000): StreamEvent {
  return { type, data, created };
}

describe("applyEvent", () => {
  it("creates an assistant message from the first text delta", () => {
    const next = applyEvent([], event("session.text.delta", {
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: "Hel",
    }));
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("msg_1");
    expect(next[0].content?.[0]).toMatchObject({ type: "text", text: "Hel" });
  });

  it("appends text deltas", () => {
    let messages: Message[] = [];
    messages = applyEvent(messages, event("session.text.delta", {
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: "Hel",
    }));
    messages = applyEvent(messages, event("session.text.delta", {
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: "lo",
    }));
    expect((messages[0].content?.[0] as { text: string }).text).toBe("Hello");
  });

  it("keeps reasoning and text parts separate", () => {
    let messages: Message[] = [];
    messages = applyEvent(messages, event("session.reasoning.delta", {
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: "think",
    }));
    messages = applyEvent(messages, event("session.text.delta", {
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: "answer",
    }));
    expect(messages[0].content?.map((part) => part.type)).toEqual(["reasoning", "text"]);
  });

  it("tracks a tool call through its lifecycle", () => {
    let messages: Message[] = [];
    messages = applyEvent(messages, event("session.tool.input.started", {
      assistantMessageID: "msg_1",
      id: "call_1",
      name: "shell",
    }));
    messages = applyEvent(messages, event("session.tool.input.delta", {
      assistantMessageID: "msg_1",
      id: "call_1",
      delta: "{\"command\":\"ls\"}",
    }));
    messages = applyEvent(messages, event("session.tool.called", {
      assistantMessageID: "msg_1",
      id: "call_1",
      input: { command: "ls" },
    }));
    messages = applyEvent(messages, event("session.tool.success", {
      assistantMessageID: "msg_1",
      id: "call_1",
      content: [{ type: "text", text: "file.txt" }],
    }));

    const tool = messages[0].content?.[0] as ToolPart;
    expect(tool.type).toBe("tool");
    expect(tool.name).toBe("shell");
    expect(tool.state.status).toBe("completed");
    expect(tool.state.content?.[0].text).toBe("file.txt");
  });

  it("marks a failed tool", () => {
    let messages: Message[] = [];
    messages = applyEvent(messages, event("session.tool.input.started", {
      assistantMessageID: "msg_1",
      id: "call_1",
      name: "read",
    }));
    messages = applyEvent(messages, event("session.tool.failed", {
      assistantMessageID: "msg_1",
      id: "call_1",
      error: { message: "missing" },
    }));
    const tool = messages[0].content?.[0] as ToolPart;
    expect(tool.state.status).toBe("error");
    expect(tool.state.error?.message).toBe("missing");
  });

  it("applies step usage to the assistant message", () => {
    const messages = applyEvent([], event("session.step.ended", {
      assistantMessageID: "msg_1",
      finish: "stop",
      cost: 0.01,
      tokens: { input: 2, output: 3 },
    }));
    expect(messages[0].cost).toBe(0.01);
    expect(messages[0].tokens?.output).toBe(3);
  });

  it("ignores unrelated events", () => {
    const existing: Message[] = [
      { id: "msg_1", type: "assistant", time: { created: 1 }, content: [] },
    ];
    expect(applyEvent(existing, event("session.usage.updated", {
      sessionID: "ses_1",
      cost: 1,
    }))).toBe(existing);
  });
});

describe("normalizeMessages", () => {
  it("assigns ordinals per part type", () => {
    const messages = normalizeMessages([
      {
        id: "msg_1",
        type: "assistant",
        time: { created: 1 },
        content: [
          { type: "reasoning", text: "a" },
          { type: "text", text: "b" },
          { type: "text", text: "c" },
        ],
      },
    ]);
    expect(messages[0].content?.[0]).toMatchObject({ type: "reasoning", ordinal: 0 });
    expect(messages[0].content?.[1]).toMatchObject({ type: "text", ordinal: 0 });
    expect(messages[0].content?.[2]).toMatchObject({ type: "text", ordinal: 1 });
  });
});
