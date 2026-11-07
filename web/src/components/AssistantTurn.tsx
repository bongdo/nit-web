import { memo, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { Agent, Message, Model, ReasoningPart, ToolPart } from "../lib/types";
import { activityLine } from "../lib/activity";
import { editedFiles, mergeFiles } from "../lib/diff";
import { stepMessageIDs } from "../lib/stream";
import { isPureHtml, looksLikeHtml } from "../lib/html";
import { modelLabel, replyText } from "../lib/format";
import { FileChips } from "./FileChips";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { ReplyActions } from "./ReplyActions";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";

function durationLabel(messages: Message[]): string {
  const first = messages[0]?.time.created;
  const last = messages[messages.length - 1];
  const end = last?.time.completed ?? last?.time.streamed ?? last?.time.created;
  if (!first || !end || end <= first) return "";
  const seconds = Math.round((end - first) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

type AssistantTurnProps = {
  messages: Message[];
  models: Model[];
  agents: Agent[];
  workspace?: string | null;
  peroURL: string;
  streaming: boolean;
  onLoadMessage?: (messageID: string) => void | Promise<void>;
};

export const AssistantTurn = memo(function AssistantTurn({
  messages,
  models,
  agents,
  workspace,
  peroURL,
  streaming,
  onLoadMessage,
}: AssistantTurnProps) {
  const [open, setOpen] = useState(false);
  const wasStreaming = useRef(streaming);
  const wasLive = useRef(streaming);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const last = messages[messages.length - 1];
  const owners = new Map<ReasoningPart | ToolPart, Message>();
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === "tool" || part.type === "reasoning") owners.set(part, message);
    }
  }
  const content = messages.flatMap((message) => message.content ?? []);
  const questionParts = content.filter(
    (part): part is ToolPart => part.type === "tool" && part.name === "question",
  );
  const activity = content.filter(
    (part): part is ReasoningPart | ToolPart =>
      part.type === "reasoning" || (part.type === "tool" && part.name !== "question"),
  );
  const textParts = content.filter((part) => part.type === "text");
  const changedFiles = mergeFiles(
    content.flatMap((part) => (part.type === "tool" ? editedFiles(part) : [])),
  );
  const toolCount = activity.filter((part) => part.type === "tool").length;
  const errorCount = activity.filter(
    (part) => part.type === "tool" && part.state.status === "error",
  ).length;
  const loadedSteps = (message: Message) =>
    (message.content ?? []).some(
      (part) =>
        part.type === "reasoning" ||
        (part.type === "tool" && part.name !== "question"),
    );
  const markerSteps = messages.reduce(
    (total, message) => total + (loadedSteps(message) ? 0 : (message.steps ?? 0)),
    0,
  );
  const markerTools = messages.reduce(
    (total, message) => total + (loadedSteps(message) ? 0 : (message.tools ?? 0)),
    0,
  );
  const markerErrors = messages.reduce(
    (total, message) => total + (loadedSteps(message) ? 0 : (message.errors ?? 0)),
    0,
  );
  const shownSteps = activity.length + markerSteps;
  const shownTools = toolCount + markerTools;
  const shownErrors = errorCount + markerErrors;
  const hasSteps = shownSteps > 0;
  const reply = messages.map(replyText).filter(Boolean).join("\n\n");
  const agent = agents.find((item) => item.id === last?.agent);
  const model = modelLabel(last?.model, models);
  const current = activity[activity.length - 1];
  const stats = [
    shownSteps > 0 ? `${shownSteps} steps` : "",
    shownTools > 0 ? `${shownTools} tools` : "",
    shownErrors > 0 ? `${shownErrors} error${shownErrors === 1 ? "" : "s"}` : "",
    durationLabel(messages),
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = streaming && current ? activityLine(current, workspace) : stats;
  const liveStats = streaming
    ? [shownSteps > 0 ? `${shownSteps} steps` : "", durationLabel(messages)]
        .filter(Boolean)
        .join(" · ")
    : "";

  useEffect(() => {
    if (streaming) {
      wasLive.current = true;
      wasStreaming.current = true;
      return;
    }
    if (wasStreaming.current) {
      wasStreaming.current = false;
      setOpen(false);
    }
  }, [streaming]);

  const loadSteps = () => {
    if (!onLoadMessage) return;
    const ids = stepMessageIDs(messages).filter(
      (id) => !(streaming && id === last?.id),
    );
    if (ids.length === 0) return;
    setLoadingSteps(true);
    Promise.allSettled(
      ids.map((id) => Promise.resolve().then(() => onLoadMessage(id))),
    ).finally(() => setLoadingSteps(false));
  };

  return (
    <div className="px-1 py-3">
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
        <span className="bg-secondary text-secondary-foreground flex size-6 items-center justify-center rounded-full">
          <Bot className="size-3.5" />
        </span>
        <span className="font-medium">{agent?.name ?? last?.agent ?? "Assistant"}</span>
        {model && <span className="text-muted-foreground truncate">{model}</span>}
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {streaming ? "running" : new Date(last?.time.created ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="min-w-0 pl-8">
        {questionParts.map((part) => (
          <QuestionCard key={`question-${part.id}`} part={part} />
        ))}

        {hasSteps && (
          <div className="border-border bg-card/40 my-2 overflow-hidden rounded-lg border">
            <div className="hover:bg-accent/40 flex w-full items-center gap-2 px-2.5 py-1.5">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  const next = !open;
                  setOpen(next);
                  if (next) loadSteps();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                {streaming ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-success" />
                ) : null}
                {loadingSteps ? (
                  <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
                ) : null}
                <span
                  className={`min-w-0 flex-1 truncate text-left text-[11px] ${
                    streaming ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {summary}
                </span>
                {liveStats && (
                  <span className="text-muted-foreground shrink-0 text-[10px]">{liveStats}</span>
                )}
              </button>
              <FileChips files={changedFiles} base={peroURL} max={2} />
            </div>
            {open && (
              <div className="border-border border-t px-1.5 py-1">
                {loadingSteps && activity.length === 0 && (
                  <div className="text-muted-foreground px-2 py-1 text-xs">Loading steps…</div>
                )}
                {activity.map((part, index) => {
                  const owner = owners.get(part);
                  const onLoad =
                    onLoadMessage && part.light && owner && !(streaming && owner.id === last?.id)
                      ? () => onLoadMessage(owner.id)
                      : undefined;
                  return part.type === "reasoning" ? (
                    <Reasoning
                      key={`reasoning-${index}`}
                      part={part}
                      streaming={streaming && index === activity.length - 1}
                      onLoad={onLoad}
                    />
                  ) : (
                    <ToolCall
                      key={`tool-${part.id ?? index}`}
                      part={part}
                      cwd={workspace}
                      peroURL={peroURL}
                      onLoad={onLoad}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {textParts.map((part, index) => {
          const pureHtml = isPureHtml(part.text);
          return (
            <div key={`text-${index}`} className="min-w-0">
              {pureHtml ? (
                <HtmlMessagePreview source={part.text} />
              ) : (
                <>
                  <Markdown text={part.text} />
                  {looksLikeHtml(part.text) && <HtmlMessagePreview source={part.text} />}
                </>
              )}
              {streaming && index === textParts.length - 1 && <span className="stream-caret" />}
            </div>
          );
        })}

        {textParts.length === 0 && !hasSteps && streaming && (
          <div className="text-muted-foreground py-2 text-xs">Waiting for the first token…</div>
        )}
        {last?.error && (
          <div className="text-destructive border-destructive/30 bg-destructive/5 mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="whitespace-pre-wrap">
              {last.error.message ?? "The assistant failed."}
            </span>
          </div>
        )}
        {!streaming && reply.trim() !== "" && (
          <ReplyActions text={reply} className="mt-2" enter={wasLive.current} />
        )}
      </div>
    </div>
  );
}, sameTurn);

function sameTurn(left: AssistantTurnProps, right: AssistantTurnProps): boolean {
  return (
    left.streaming === right.streaming &&
    left.workspace === right.workspace &&
    left.peroURL === right.peroURL &&
    left.models === right.models &&
    left.agents === right.agents &&
    left.onLoadMessage === right.onLoadMessage &&
    sameMessages(left.messages, right.messages)
  );
}

function sameMessages(left: Message[], right: Message[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((message, index) => message === right[index]);
}
