import { describe, expect, it } from "vitest";
import {
  applyEvent,
  coalesceEvents,
  lightenEvent,
  lightMessages,
  lightStepIDs,
  normalizeMessages,
} from "./stream";
import type { Message, StreamEvent, ToolPart } from "./types";

function event(type: string, data: Record<string, unknown>, created = 1_000): StreamEvent {
  return { type, data, created };
}

function questionTool(id: string, state: ToolPart["state"]): ToolPart {
  return { type: "tool", id, name: "question", state };
}

function questionMessage(part: ToolPart): Message {
  return { id: "msg_1", type: "assistant", time: { created: 1 }, content: [part] };
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

describe("coalesceEvents", () => {
  it("merges adjacent deltas of the same part", () => {
    const merged = coalesceEvents([
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "Hel" }),
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "lo" }),
      event("session.reasoning.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "why" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].data.delta).toBe("Hello");
    expect(merged[1].data.delta).toBe("why");
  });

  it("keeps deltas for different parts apart", () => {
    const merged = coalesceEvents([
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "a" }),
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 1, delta: "b" }),
      event("session.tool.input.delta", { assistantMessageID: "msg_1", id: "call_1", delta: "c" }),
      event("session.tool.input.delta", { assistantMessageID: "msg_1", id: "call_2", delta: "d" }),
    ]);
    expect(merged.map((item) => item.data.delta)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not merge across other events", () => {
    const merged = coalesceEvents([
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "a" }),
      event("session.step.started", { assistantMessageID: "msg_1" }),
      event("session.text.delta", { assistantMessageID: "msg_1", ordinal: 0, delta: "b" }),
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe("light transcripts", () => {
  it("strips tool content and trims reasoning", () => {
    const long = "r".repeat(400);
    const messages: Message[] = [
      {
        id: "m1",
        type: "assistant",
        time: { created: 1 },
        content: [
          { type: "reasoning", text: long, ordinal: 0 },
          {
            type: "tool",
            id: "t1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "/tmp/a" },
              content: [{ type: "text", text: "output" }],
            },
          },
          { type: "text", text: "answer", ordinal: 0 },
        ],
      },
    ];
    const light = lightMessages(messages);
    const parts = light[0].content ?? [];
    expect(parts[0]).toMatchObject({ type: "reasoning", text: "", light: true });
    expect(parts[1]).toMatchObject({ type: "tool", light: true });
    expect((parts[1] as ToolPart).state.content).toBeUndefined();
    expect((parts[1] as ToolPart).state.input).toBeUndefined();
    expect(parts[2]).toMatchObject({ type: "text", text: "answer" });
  });

  it("drops tool output from cached events", () => {
    const next = lightenEvent(
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "t1",
        content: [{ type: "text", text: "x".repeat(400) }],
      }),
    );
    expect(next?.data.light).toBe(true);
    expect(next?.data.content).toEqual([]);
  });

  it("keeps a light reasoning stub without its text", () => {
    const next = lightenEvent(
      event("session.reasoning.ended", {
        assistantMessageID: "msg_1",
        ordinal: 0,
        text: "thinking",
      }),
    );
    expect(next?.data.text).toBe("");
    const messages = applyEvent([], next as StreamEvent);
    const part = messages[0].content?.[0] as { type: string; text: string; light?: boolean };
    expect(part).toMatchObject({ type: "reasoning", text: "", light: true });
  });

  it("drops reasoning deltas from the cache", () => {
    expect(
      lightenEvent(
        event("session.reasoning.delta", {
          assistantMessageID: "msg_1",
          delta: "thinking",
        }),
      ),
    ).toBeNull();
  });

  it("keeps question tools out of the lazy step path", () => {
    const question = {
      type: "tool",
      id: "q1",
      name: "question",
      state: {
        status: "completed",
        input: { questions: [{ question: "Pick" }] },
        content: [{ type: "text", text: "A" }],
        metadata: { answers: [["A"]] },
      },
    } as ToolPart;
    const messages: Message[] = [
      { id: "m1", type: "assistant", time: { created: 1 }, content: [question] },
    ];
    expect(lightMessages(messages)[0].content?.[0]).toBe(question);
    const next = lightenEvent(
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "q1",
        name: "question",
        content: [{ type: "text", text: "A" }],
        metadata: { answers: [["A"]] },
      }),
    );
    expect(next?.data.content).toEqual([{ type: "text", text: "A" }]);
    expect(next?.data.light).toBeUndefined();
  });

  it("keeps answered and pending question parts whole", () => {
    const input = { questions: [{ question: "Pick", options: [{ label: "A" }] }] };
    const answered = questionTool("q1", {
      status: "completed",
      input,
      content: [{ type: "text", text: "User answered: A" }],
      metadata: { answers: [["A"]] },
    });
    const pending = questionTool("q2", {
      status: "running",
      input: { questions: [{ question: "Name it" }] },
    });
    const messages: Message[] = [
      {
        id: "m1",
        type: "assistant",
        time: { created: 1 },
        content: [answered, pending],
      },
    ];
    const light = lightMessages(messages);
    expect(light[0].content?.[0]).toBe(answered);
    expect(light[0].content?.[1]).toBe(pending);
  });

  it("keeps question events out of the light cache", () => {
    const cached = [
      questionMessage(
        questionTool("q1", {
          status: "running",
          input: { questions: [{ question: "Pick" }] },
        }),
      ),
    ];
    const events = [
      event("session.tool.input.started", {
        assistantMessageID: "msg_1",
        id: "q1",
        name: "question",
      }),
      event("session.tool.input.delta", {
        assistantMessageID: "msg_1",
        id: "q1",
        delta: '{"questions":[',
      }),
      event("session.tool.input.ended", {
        assistantMessageID: "msg_1",
        id: "q1",
        text: '{"questions":[{"question":"Pick"}]}',
      }),
      event("session.tool.called", {
        assistantMessageID: "msg_1",
        id: "q1",
        input: { questions: [{ question: "Pick" }] },
        executed: false,
      }),
      event("session.tool.progress", {
        assistantMessageID: "msg_1",
        id: "q1",
        metadata: { answers: [["A"]] },
      }),
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "q1",
        content: [{ type: "text", text: "User answered: A" }],
        metadata: { answers: [["A"]] },
      }),
      event("session.tool.failed", {
        assistantMessageID: "msg_1",
        id: "q1",
        error: { message: "cancelled" },
      }),
      event("session.tool.error", {
        assistantMessageID: "msg_1",
        id: "q1",
        error: { message: "cancelled" },
      }),
    ];
    for (const item of events) {
      expect(lightenEvent(item, cached)).toBe(item);
    }
    expect(lightenEvent(events[0])).toBe(events[0]);
  });

  it("keeps an answered question whole through the cache", () => {
    const input = {
      questions: [{ question: "Pick", options: [{ label: "A" }] }],
    };
    const events = [
      event("session.tool.input.started", {
        assistantMessageID: "msg_1",
        id: "q1",
        name: "question",
      }),
      event("session.tool.input.delta", {
        assistantMessageID: "msg_1",
        id: "q1",
        delta: '{"questions":[',
      }),
      event("session.tool.input.ended", {
        assistantMessageID: "msg_1",
        id: "q1",
        text: JSON.stringify(input),
      }),
      event("session.tool.called", {
        assistantMessageID: "msg_1",
        id: "q1",
        input,
        executed: false,
      }),
      event("session.tool.progress", {
        assistantMessageID: "msg_1",
        id: "q1",
        metadata: { answers: [["A"]] },
      }),
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "q1",
        content: [{ type: "text", text: "User answered: A" }],
        metadata: { answers: [["A"]] },
      }),
    ];
    let messages: Message[] = [];
    for (const item of events) {
      const light = lightenEvent(item, messages);
      expect(light).toBe(item);
      messages = applyEvent(messages, light as StreamEvent);
    }
    const part = messages[0].content?.[0] as ToolPart;
    expect(part.name).toBe("question");
    expect(part.light).not.toBe(true);
    expect(part.state.status).toBe("completed");
    expect(part.state.input).toEqual(input);
    expect(part.state.content).toEqual([{ type: "text", text: "User answered: A" }]);
    expect(part.state.metadata?.answers).toEqual([["A"]]);
  });

  it("keeps a pending question pending through the cache", () => {
    let messages = applyEvent(
      [],
      event("session.tool.input.started", {
        assistantMessageID: "msg_1",
        id: "q1",
        name: "question",
      }),
    );
    const delta = event("session.tool.input.delta", {
      assistantMessageID: "msg_1",
      id: "q1",
      delta: '{"questions":[',
    });
    const light = lightenEvent(delta, messages);
    expect(light).toBe(delta);
    messages = applyEvent(messages, light as StreamEvent);
    const part = messages[0].content?.[0] as ToolPart;
    expect(part.state.status).toBe("streaming");
    expect(part.state.input).toBe('{"questions":[');
    expect(part.light).not.toBe(true);
  });

  it("keeps question state when it fails", () => {
    const question = questionTool("q1", {
      status: "running",
      input: { questions: [{ question: "Pick" }] },
      content: [{ type: "text", text: "partial" }],
      metadata: { answers: [["A"]] },
    });
    const cached = [questionMessage(question)];
    for (const type of ["session.tool.failed", "session.tool.error"]) {
      const failure = event(type, {
        assistantMessageID: "msg_1",
        id: "q1",
        error: { message: "cancelled" },
      });
      expect(lightenEvent(failure, cached)).toBe(failure);
      const part = applyEvent(cached, failure)[0].content?.[0] as ToolPart;
      expect(part.light).not.toBe(true);
      expect(part.state.input).toEqual(question.state.input);
      expect(part.state.content).toEqual(question.state.content);
      expect(part.state.metadata?.answers).toEqual([["A"]]);
      expect(part.state.error?.message).toBe("cancelled");
    }
  });

  it("clears a stale light flag on a question", () => {
    const question = questionTool("q1", {
      status: "completed",
      input: { questions: [{ question: "Pick" }] },
      content: [{ type: "text", text: "User answered: A" }],
      metadata: { answers: [["A"]] },
    });
    question.light = true;
    const cached = [questionMessage(question)];
    const success = event("session.tool.success", {
      assistantMessageID: "msg_1",
      id: "q1",
      content: [{ type: "text", text: "User answered: A" }],
      metadata: { answers: [["A"]] },
    });
    expect(lightenEvent(success, cached)).toBe(success);
    const part = applyEvent(cached, success)[0].content?.[0] as ToolPart;
    expect(part.light).toBe(false);
    expect(part.state.content).toEqual([{ type: "text", text: "User answered: A" }]);
    expect(part.state.metadata?.answers).toEqual([["A"]]);
  });

  it("lists messages whose steps are still light", () => {
    const light = {
      id: "m1",
      type: "assistant",
      time: { created: 1 },
      content: [{ type: "tool", id: "t1", name: "read", light: true, state: { status: "completed" } }],
    } as Message;
    const full = {
      id: "m2",
      type: "assistant",
      time: { created: 2 },
      content: [{ type: "tool", id: "t2", name: "read", state: { status: "completed" } }],
    } as Message;
    expect(lightStepIDs([light, full])).toEqual(["m1"]);
  });

  it("marks a light tool as loaded when the full event arrives", () => {
    let messages = applyEvent(
      [],
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "t1",
        content: [],
        light: true,
      }),
    );
    expect((messages[0].content?.[0] as ToolPart).light).toBe(true);
    messages = applyEvent(
      messages,
      event("session.tool.success", {
        assistantMessageID: "msg_1",
        id: "t1",
        content: [{ type: "text", text: "full" }],
      }),
    );
    expect((messages[0].content?.[0] as ToolPart).light).toBe(false);
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
