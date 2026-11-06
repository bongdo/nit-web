import type { Message, ReasoningPart, StreamEvent, TextPart, ToolPart, ToolState } from "./types";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.type !== "assistant" || !message.content) return message;
    let text = 0;
    let reasoning = 0;
    const content = message.content.map((part) => {
      if (part.type === "text") return { ...part, ordinal: part.ordinal ?? text++ };
      if (part.type === "reasoning") {
        return { ...part, ordinal: part.ordinal ?? reasoning++ };
      }
      return part;
    });
    return { ...message, content };
  });
}

export function lightMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (!message.content?.length) return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (part.type === "reasoning") {
        if (part.text === "") return part;
        changed = true;
        return { ...part, text: "", light: true };
      }
      if (part.type !== "tool") return part;
      const hasContent = Boolean(part.state.content?.length);
      const hasInput = part.state.input !== undefined;
      const hasMetadata = part.state.metadata !== undefined;
      if (!hasContent && !hasInput && !hasMetadata) return part;
      changed = true;
      return {
        ...part,
        light: true,
        state: {
          ...part.state,
          content: undefined,
          input: undefined,
          metadata: undefined,
        },
      };
    });
    return changed ? { ...message, content } : message;
  });
}

export function lightenEvent(event: StreamEvent): StreamEvent | null {
  const data = event.data ?? {};
  switch (event.type) {
    case "session.reasoning.delta":
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.progress":
      return null;
    case "session.reasoning.started":
    case "session.reasoning.ended":
      return { ...event, data: { ...data, text: "", light: true } };
    case "session.tool.called":
      return { ...event, data: { ...data, input: undefined, light: true } };
    case "session.tool.success":
      return { ...event, data: { ...data, content: [], light: true } };
    default:
      return event;
  }
}

function deltaKey(event: StreamEvent): string {
  if (
    event.type !== "session.text.delta" &&
    event.type !== "session.reasoning.delta" &&
    event.type !== "session.tool.input.delta"
  ) {
    return "";
  }
  const data = event.data ?? {};
  const messageID = str(data.assistantMessageID);
  if (!messageID) return "";
  return `${event.type}|${messageID}|${num(data.ordinal) ?? 0}|${str(data.id)}`;
}

export function coalesceEvents(events: StreamEvent[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const event of events) {
    const key = deltaKey(event);
    const last = out[out.length - 1];
    if (key && last && deltaKey(last) === key) {
      out[out.length - 1] = {
        ...last,
        data: { ...last.data, delta: str(last.data.delta) + str(event.data.delta) },
      };
      continue;
    }
    out.push(event);
  }
  return out;
}

function updateMessage(
  messages: Message[],
  id: string,
  event: StreamEvent,
  update: (message: Message) => Message,
): Message[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) {
    const base: Message = {
      id,
      type: "assistant",
      time: { created: event.created ?? Date.now() },
      content: [],
    };
    return [...messages, update(base)];
  }
  const next = messages.slice();
  next[index] = update(next[index]);
  return next;
}

function upsertText(
  message: Message,
  kind: "text" | "reasoning",
  ordinal: number,
  update: (current: string) => string,
  light?: boolean,
): Message {
  const content = [...(message.content ?? [])];
  const index = content.findIndex(
    (part) =>
      (part.type === "text" || part.type === "reasoning") &&
      part.type === kind &&
      (part.ordinal ?? 0) === ordinal,
  );
  if (index >= 0) {
    const part = content[index] as TextPart | ReasoningPart;
    content[index] = {
      ...part,
      text: update(part.text),
      ...(light === undefined ? {} : { light }),
    };
  } else {
    content.push({ type: kind, text: update(""), ordinal, ...(light ? { light } : {}) });
  }
  return { ...message, content };
}

function upsertTool(
  message: Message,
  id: string,
  name: string,
  update: (part: ToolPart) => ToolPart,
): Message {
  const content = [...(message.content ?? [])];
  const index = content.findIndex((part) => part.type === "tool" && part.id === id);
  if (index >= 0) {
    content[index] = update(content[index] as ToolPart);
  } else {
    content.push(
      update({
        type: "tool",
        id,
        name,
        state: { status: "streaming", input: "" },
        time: { created: Date.now() },
      }),
    );
  }
  return { ...message, content };
}

function mergeState(part: ToolPart, state: ToolState): ToolPart {
  return { ...part, state: { ...part.state, ...state } };
}

export function applyEvent(messages: Message[], event: StreamEvent): Message[] {
  const data = event.data ?? {};
  const id = str(data.assistantMessageID);
  if (!id) return messages;
  const ordinal = num(data.ordinal) ?? 0;

  switch (event.type) {
    case "session.step.started":
      return updateMessage(messages, id, event, (message) => ({
        ...message,
        agent: str(data.agent) || message.agent,
        model:
          data.model && typeof data.model === "object"
            ? (data.model as Message["model"])
            : message.model,
        time: { ...message.time, created: message.time.created || num(data.started) || Date.now() },
      }));

    case "session.text.started":
      return updateMessage(messages, id, event, (message) =>
        upsertText(message, "text", ordinal, (current) => str(data.text) || current),
      );

    case "session.text.delta":
      return updateMessage(messages, id, event, (message) =>
        upsertText(message, "text", ordinal, (current) => current + str(data.delta)),
      );

    case "session.text.ended":
      return updateMessage(messages, id, event, (message) => {
        const full = str(data.text);
        if (!full) return message;
        return upsertText(message, "text", ordinal, () => full);
      });

    case "session.reasoning.started":
      return updateMessage(messages, id, event, (message) =>
        upsertText(
          message,
          "reasoning",
          ordinal,
          (current) => str(data.text) || current,
          data.light ? true : undefined,
        ),
      );

    case "session.reasoning.delta":
      return updateMessage(messages, id, event, (message) =>
        upsertText(
          message,
          "reasoning",
          ordinal,
          (current) => current + str(data.delta),
          data.light ? true : undefined,
        ),
      );

    case "session.reasoning.ended":
      return updateMessage(messages, id, event, (message) => {
        const full = str(data.text);
        if (!full) return message;
        return upsertText(message, "reasoning", ordinal, () => full, Boolean(data.light));
      });

    case "session.tool.input.started": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name), (part) => ({
          ...part,
          time: { ...part.time, created: event.created ?? part.time?.created },
        })),
      );
    }

    case "session.tool.input.delta": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => {
          const current = typeof part.state.input === "string" ? part.state.input : "";
          return mergeState(part, { status: "streaming", input: current + str(data.delta) });
        }),
      );
    }

    case "session.tool.input.ended": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => ({
          ...mergeState(part, {
            status: "streaming",
            input: str(data.text) || part.state.input,
          }),
          ...(data.light ? { light: true } : {}),
        })),
      );
    }

    case "session.tool.called": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => ({
          ...part,
          ...(data.light ? { light: true } : {}),
          executed: Boolean(data.executed),
          state: {
            status: "running",
            input: data.input ?? part.state.input,
            metadata: {},
          },
        })),
      );
    }

    case "session.tool.progress": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) =>
          mergeState(part, {
            status: "running",
            metadata: {
              ...(part.state.metadata ?? {}),
              ...(data.metadata && typeof data.metadata === "object"
                ? (data.metadata as Record<string, unknown>)
                : {}),
            },
          }),
        ),
      );
    }

    case "session.tool.success": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => ({
          ...part,
          light: Boolean(data.light),
          state: {
            status: "completed",
            input: part.state.input,
            content: Array.isArray(data.content) ? (data.content as ToolState["content"]) : [],
            metadata: {
              ...(part.state.metadata ?? {}),
              ...(data.metadata && typeof data.metadata === "object"
                ? (data.metadata as Record<string, unknown>)
                : {}),
            },
          },
        })),
      );
    }

    case "session.tool.failed":
    case "session.tool.error": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => ({
          ...part,
          state: {
            status: "error",
            input: part.state.input,
            error:
              data.error && typeof data.error === "object"
                ? (data.error as ToolState["error"])
                : { message: "Tool failed" },
          },
        })),
      );
    }

    case "session.step.ended":
      return updateMessage(messages, id, event, (message) => ({
        ...message,
        finish: str(data.finish) || message.finish,
        cost: num(data.cost) ?? message.cost,
        tokens:
          data.tokens && typeof data.tokens === "object"
            ? (data.tokens as Message["tokens"])
            : message.tokens,
      }));

    case "session.step.failed":
      return updateMessage(messages, id, event, (message) => ({
        ...message,
        error:
          data.error && typeof data.error === "object"
            ? (data.error as Message["error"])
            : message.error,
      }));

    default:
      return messages;
  }
}
