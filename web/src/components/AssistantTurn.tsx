import { memo, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, CircleAlert, ListTree, Loader2 } from "lucide-react";
import type { Agent, Message, Model, ReasoningPart, ToolPart } from "../lib/types";
import { activityLine } from "../lib/activity";
import { turnEditedFiles } from "../lib/diff";
import { stepMessageIDs } from "../lib/stream";
import { htmlArtifactSegments, isPureHtml } from "../lib/html";
import { modelLabel, replyText, turnBlocks } from "../lib/format";
import { timeLabel, type TimeFormat } from "../lib/time";
import { useSmoothText } from "../hooks/useSmoothText";
import { cn } from "../lib/utils";
import { ChangedFilesButton, FileList } from "./FileChips";
import { HtmlArtifact } from "./HtmlArtifact";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { MarkdownLazy } from "./MarkdownLazy";
import { QuestionCard } from "./QuestionCard";
import { ReplyActions } from "./ReplyActions";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";
import { Button } from "./ui/button";

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
  sessionID: string;
  instance: string;
  models: Model[];
  agents: Agent[];
  workspace?: string | null;
  peroURL: string;
  streaming: boolean;
  timeFormat: TimeFormat;
  showTime: boolean;
  showSteps: boolean;
  onLoadMessage?: (messageID: string) => void | Promise<void>;
};

export const AssistantTurn = memo(function AssistantTurn({
  messages,
  sessionID,
  instance,
  models,
  agents,
  workspace,
  peroURL,
  streaming,
  timeFormat,
  showTime,
  showSteps,
  onLoadMessage,
}: AssistantTurnProps) {
  const [open, setOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const filesRef = useRef<HTMLDivElement | null>(null);
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
  const activity = content.filter(
    (part): part is ReasoningPart | ToolPart =>
      part.type === "reasoning" || (part.type === "tool" && part.name !== "question"),
  );
  const textParts = content.filter((part) => part.type === "text");
  const changedFiles = turnEditedFiles(messages);
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
  const blocks = turnBlocks(content, hasSteps);
  const lastText = textParts[textParts.length - 1];
  const liveText = streaming ? lastText : undefined;
  const revealed = useSmoothText(liveText?.text ?? "", Boolean(liveText));
  const reply = messages.map(replyText).filter(Boolean).join("\n\n");
  const agent = agents.find((item) => item.id === last?.agent);
  const agentName = agent?.name ?? last?.agent ?? "";
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

  useEffect(() => {
    if (!showFiles) return;
    const onPointer = (event: MouseEvent) => {
      if (!filesRef.current?.contains(event.target as Node)) setShowFiles(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFiles(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showFiles]);

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
        {(streaming || showTime) && (
          <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
            {streaming
              ? "running"
              : timeLabel(last?.time.created ?? Date.now(), timeFormat)}
          </span>
        )}
      </div>

      <div className="min-w-0 pl-8">
        {blocks.map((block, index) => {
          if (block.kind === "steps") {
            if (!showSteps && !open) return null;
            return (
              <div
                key="steps"
                className="border-border bg-card/40 my-2 overflow-hidden rounded-lg border"
              >
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
                          agent={agentName}
                          onLoad={onLoad}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          if (block.kind === "question") {
            return (
              <QuestionCard
                key={`question-${block.part.id}`}
                part={block.part}
                timeFormat={timeFormat}
                showTime={showTime}
              />
            );
          }
          const live = streaming && block.part === lastText;
          const text = live ? revealed : block.part.text;
          const pureHtml = isPureHtml(text);
          const page = pureHtml || /^\s*</.test(text);
          const segments = htmlArtifactSegments(text);
          return (
            <div
              key={`text-${index}`}
              className={cn("min-w-0", live && text.trim() !== "" && "stream-soft")}
            >
              {live && page ? (
                <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Writing page…
                </div>
              ) : (
                segments.map((segment, segmentIndex) => (
                  <div key={`segment-${segmentIndex}`} className="min-w-0">
                    {segment.text.trim() !== "" && (
                      <MarkdownLazy
                        text={segment.text}
                        streaming={live}
                        directory={workspace}
                        peroURL={peroURL}
                      />
                    )}
                    {segment.artifacts.map((artifact) => {
                      const key =
                        "source" in artifact ? `source-${segmentIndex}` : artifact.path;
                      if (live) {
                        return (
                          <div
                            key={key}
                            className="text-muted-foreground my-3 flex items-center gap-2 text-xs"
                          >
                            <Loader2 className="size-3.5 animate-spin" />
                            Page appears when the reply finishes…
                          </div>
                        );
                      }
                      return "source" in artifact ? (
                        <HtmlArtifact
                          key={key}
                          source={artifact.source}
                          sessionID={sessionID}
                          instance={instance}
                        />
                      ) : (
                        <HtmlArtifact
                          key={key}
                          path={artifact.path}
                          title={artifact.title}
                          sessionID={sessionID}
                          instance={instance}
                        />
                      );
                    })}
                  </div>
                ))
              )}
              {!live &&
                !segments.some((segment) =>
                  segment.artifacts.some((artifact) => "source" in artifact),
                ) &&
                pureHtml && <HtmlMessagePreview source={text} />}
              {live && !page && <span className="stream-caret" />}
            </div>
          );
        })}

        {textParts.length === 0 && streaming && (
          showSteps ? (
            !hasSteps && (
              <div className="text-muted-foreground py-2 text-xs">Waiting for the first token…</div>
            )
          ) : (
            <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="min-w-0 truncate">{summary || "Waiting for the first token…"}</span>
            </div>
          )
        )}
        {last?.error && (
          <div className="text-destructive border-destructive/30 bg-destructive/5 mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="whitespace-pre-wrap">
              {last.error.message ?? "The assistant failed."}
            </span>
          </div>
        )}
        {((!streaming && reply.trim() !== "") || changedFiles.length > 0 || (!showSteps && hasSteps)) && (
          <div
            ref={filesRef}
            className="relative mt-2 flex flex-wrap items-center gap-2"
          >
            {!showSteps && hasSteps && (
              <Button
                variant="ghost"
                size="xs"
                className={cn("text-muted-foreground", open && "text-foreground")}
                aria-expanded={open}
                onClick={() => {
                  const next = !open;
                  setOpen(next);
                  if (next) loadSteps();
                }}
              >
                <ListTree />
                <span>Steps{shownSteps > 0 ? ` · ${shownSteps}` : ""}</span>
                {shownErrors > 0 && <CircleAlert className="text-destructive" />}
              </Button>
            )}
            {!streaming && reply.trim() !== "" && (
              <ReplyActions text={reply} enter={wasLive.current} />
            )}
            {changedFiles.length > 0 && (
              <ChangedFilesButton
                count={changedFiles.length}
                open={showFiles}
                onClick={() => setShowFiles((value) => !value)}
              />
            )}
            {showFiles && changedFiles.length > 0 && (
              <div className="file-popover-enter bg-popover text-popover-foreground border-border absolute bottom-full left-0 z-20 mb-2 w-max max-w-full rounded-lg border p-2 shadow-lg">
                <FileList
                  files={changedFiles}
                  base={peroURL}
                  cwd={workspace}
                  agent={agentName}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}, sameTurn);

function sameTurn(left: AssistantTurnProps, right: AssistantTurnProps): boolean {
  return (
    left.streaming === right.streaming &&
    left.sessionID === right.sessionID &&
    left.instance === right.instance &&
    left.workspace === right.workspace &&
    left.peroURL === right.peroURL &&
    left.models === right.models &&
    left.agents === right.agents &&
    left.timeFormat === right.timeFormat &&
    left.showTime === right.showTime &&
    left.showSteps === right.showSteps &&
    left.onLoadMessage === right.onLoadMessage &&
    sameMessages(left.messages, right.messages)
  );
}

function sameMessages(left: Message[], right: Message[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((message, index) => message === right[index]);
}
