import type {
  Message,
  Part,
  ReasoningPart,
  StreamEvent,
  TextPart,
  ToolPart,
  ToolState,
} from "./types";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function cachedQuestion(event: StreamEvent, messages: Message[]): boolean {
  const data = event.data ?? {};
  const id = str(data.id);
  if (!id) return false;
  const messageID = str(data.assistantMessageID);
  return messages.some(
    (message) =>
      (!messageID || message.id === messageID) &&
      (message.content ?? []).some(
        (part) => part.type === "tool" && part.id === id && part.name === "question",
      ),
  );
}

function isQuestionEvent(
  event: StreamEvent,
  messages: Message[],
  questionIDs?: Set<string>,
): boolean {
  const data = event.data ?? {};
  if (str(data.name) === "question") return true;
  const id = str(data.id);
  if (!id) return false;
  return questionIDs?.has(id) === true || cachedQuestion(event, messages);
}

function hasMessage(event: StreamEvent, messages: Message[]): boolean {
  const id = str((event.data ?? {}).assistantMessageID);
  return Boolean(id) && messages.some((message) => message.id === id);
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
    if (message.type !== "assistant" || !message.content?.length) return message;
    let steps = 0;
    let tools = 0;
    let errors = 0;
    const content: Part[] = [];
    for (const part of message.content) {
      if (part.type === "reasoning") {
        steps += 1;
        continue;
      }
      if (part.type === "tool" && part.name !== "question") {
        steps += 1;
        tools += 1;
        if (part.state.status === "error") errors += 1;
        continue;
      }
      content.push(part);
    }
    if (steps === 0) return message;
    const next: Message = { ...message, content, steps };
    if (tools > 0) next.tools = tools;
    else delete next.tools;
    if (errors > 0) next.errors = errors;
    else delete next.errors;
    return next;
  });
}

export function lightenEvent(
  event: StreamEvent,
  messages: Message[] = [],
  questionIDs?: Set<string>,
): StreamEvent | null {
  const data = event.data ?? {};
  if (isQuestionEvent(event, messages, questionIDs)) {
    if (str(data.name) === "question" || cachedQuestion(event, messages)) return event;
    return { ...event, data: { ...data, name: "question" } };
  }
  switch (event.type) {
    case "session.step.started":
    case "session.step.ended":
    case "session.step.failed":
      return hasMessage(event, messages) ? event : null;
    case "session.reasoning.started":
    case "session.reasoning.delta":
    case "session.reasoning.ended":
    case "session.tool.input.started":
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.called":
    case "session.tool.progress":
    case "session.tool.success":
    case "session.tool.failed":
    case "session.tool.error":
      return null;
    default:
      return event;
  }
}

export function planRetry(
  messages: Message[],
  error: Message["error"] | undefined,
  attempt: number,
): { text: string; files: { uri: string; name?: string }[]; delay: number } | null {
  if (!isRetryableFailure(error)) return null;
  const user = [...messages].reverse().find((item) => item.type === "user");
  if (!user?.id || user.id.startsWith("local-")) return null;
  const files = (user.files ?? []).flatMap((file) =>
    typeof file.uri === "string" ? [{ uri: file.uri, name: file.name }] : [],
  );
  return {
    text: user.text ?? "",
    files,
    delay: retryDelay(attempt, error?.retryAfterMs),
  };
}

export function isRetryableFailure(error: Message["error"] | undefined): boolean {
  if (!error) return false;
  const text = (error.message ?? "").toLowerCase();
  if (text.includes("overloaded") || text.includes("retry shortly")) return true;
  if (text.includes("rate limit") || text.includes("temporarily unavailable")) return true;
  return error.status === 429 || error.status === 503 || error.status === 529;
}

export function retryDelay(attempt: number, retryAfterMs?: number): number {
  const backoff = Math.min(30_000, 2_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 4));
  const requested = typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : 0;
  return Math.min(30_000, Math.max(backoff, requested));
}

export function stepMessageIDs(messages: Message[]): string[] {
  return messages
    .filter(
      (message) =>
        (message.steps ?? 0) > 0 &&
        !(message.content ?? []).some(
          (part) =>
            part.type === "reasoning" ||
            (part.type === "tool" && part.name !== "question"),
        ),
    )
    .map((message) => message.id);
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

function clearStepMarkers(message: Message): Message {
  if (message.steps === undefined && message.tools === undefined && message.errors === undefined) {
    return message;
  }
  const next = { ...message };
  delete next.steps;
  delete next.tools;
  delete next.errors;
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
  const next = { ...message, content };
  return kind === "reasoning" ? clearStepMarkers(next) : next;
}

function clearQuestionLight(part: ToolPart): ToolPart {
  return part.name === "question" ? { ...part, light: false } : part;
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
    content[index] = clearQuestionLight(update(content[index] as ToolPart));
  } else {
    content.push(
      clearQuestionLight(
        update({
          type: "tool",
          id,
          name,
          state: { status: "streaming", input: "" },
          time: { created: Date.now() },
        }),
      ),
    );
  }
  return clearStepMarkers({ ...message, content });
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
        if (!full && !data.light) return message;
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
        upsertTool(message, toolID, str(data.name) || "tool", (part) => {
          const question = part.name === "question";
          const light = !question && Boolean(data.light);
          return {
            ...part,
            light,
            executed: Boolean(data.executed),
            state: {
              status: "running",
              input: light ? undefined : (data.input ?? part.state.input),
              metadata: question ? (part.state.metadata ?? {}) : {},
            },
          };
        }),
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
        upsertTool(message, toolID, str(data.name) || "tool", (part) => {
          const question = part.name === "question";
          const content = Array.isArray(data.content)
            ? (data.content as ToolState["content"])
            : undefined;
          const kept = question && !content?.length ? part.state.content : content;
          return {
            ...part,
            light: !question && Boolean(data.light),
            state: {
              status: "completed",
              input: part.state.input,
              content: kept ?? [],
              metadata: {
                ...(part.state.metadata ?? {}),
                ...(data.metadata && typeof data.metadata === "object"
                  ? (data.metadata as Record<string, unknown>)
                  : {}),
              },
            },
          };
        }),
      );
    }

    case "session.tool.failed":
    case "session.tool.error": {
      const toolID = str(data.id);
      if (!toolID) return messages;
      return updateMessage(messages, id, event, (message) =>
        upsertTool(message, toolID, str(data.name) || "tool", (part) => {
          const question = part.name === "question";
          const content = Array.isArray(data.content)
            ? (data.content as ToolState["content"])
            : undefined;
          const kept = question && !content?.length ? part.state.content : content;
          return {
            ...part,
            state: {
              status: "error",
              input: part.state.input,
              content: kept ?? part.state.content,
              metadata: {
                ...(part.state.metadata ?? {}),
                ...(data.metadata && typeof data.metadata === "object"
                  ? (data.metadata as Record<string, unknown>)
                  : {}),
              },
              error:
                data.error && typeof data.error === "object"
                  ? (data.error as ToolState["error"])
                  : { message: "Tool failed" },
            },
          };
        }),
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
