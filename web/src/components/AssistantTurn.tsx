import { memo, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, CircleAlert, ListTree, Loader2 } from "lucide-react";
import type { Agent, Message, Model, ReasoningPart, ToolPart } from "../lib/types";
import { activityLine, toolBreakdown } from "../lib/activity";
import { api } from "../lib/api";
import { turnEditedFiles } from "../lib/diff";
import { stepMessageIDs } from "../lib/stream";
import { htmlArtifactSegments, isPureHtml } from "../lib/html";
import { modelLabel, replyText, turnBlocks } from "../lib/format";
import { timeLabel, type TimeFormat } from "../lib/time";
import { useSmoothText } from "../hooks/useSmoothText";
import { cn } from "../lib/utils";
import { ActivityLog } from "./ActivityLog";
import { ChangedFilesButton, FileList } from "./FileChips";
import { HtmlArtifact } from "./HtmlArtifact";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { MarkdownLazy } from "./MarkdownLazy";
import { QuestionCard } from "./QuestionCard";
import { ReplyActions } from "./ReplyActions";
import { Button } from "./ui/button";
import { Modal } from "./ui/Modal";

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
}: AssistantTurnProps) {
  const [open, setOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [details, setDetails] = useState<Record<string, Message>>({});
  const filesRef = useRef<HTMLDivElement | null>(null);
  const wasStreaming = useRef(streaming);
  const wasLive = useRef(streaming);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const last = messages[messages.length - 1];
  const view =
    Object.keys(details).length === 0
      ? messages
      : messages.map((message) => details[message.id] ?? message);
  const content = view.flatMap((message) => message.content ?? []);
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
  const loadedIDs = new Set(Object.keys(details));
  const markerOr = (count: number | undefined, message: Message) =>
    loadedIDs.has(message.id) ? 0 : (count ?? 0);
  const markerSteps = messages.reduce(
    (total, message) => total + markerOr(message.steps, message),
    0,
  );
  const markerTools = messages.reduce(
    (total, message) => total + markerOr(message.tools, message),
    0,
  );
  const markerErrors = messages.reduce(
    (total, message) => total + markerOr(message.errors, message),
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
  const breakdown = toolBreakdown(activity, workspace).slice(0, 6);

  useEffect(() => {
    if (streaming) {
      wasLive.current = true;
      wasStreaming.current = true;
      return;
    }
    if (wasStreaming.current) {
      wasStreaming.current = false;
      if (showSteps) {
        setOpen(false);
        setDetails({});
      }
    }
  }, [showSteps, streaming]);

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

  const loadSteps = async () => {
    if (loadingSteps) return;
    const ids = stepMessageIDs(messages).filter(
      (id) => !details[id] && !(streaming && id === last?.id),
    );
    if (ids.length === 0) return;
    setLoadingSteps(true);
    setStepsError(null);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api.message(sessionID, id)),
      );
      const next: Record<string, Message> = {};
      let failed = false;
      for (const [index, id] of ids.entries()) {
        const result = results[index];
        if (result?.status === "fulfilled") next[id] = result.value;
        else failed = true;
      }
      if (Object.keys(next).length > 0) {
        setDetails((current) => ({ ...current, ...next }));
      }
      if (failed) setStepsError("Some steps could not be loaded.");
    } finally {
      setLoadingSteps(false);
    }
  };

  const openSteps = async () => {
    await loadSteps();
    setOpen(true);
  };

  const closeSteps = () => {
    setOpen(false);
    setDetails({});
    setStepsError(null);
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
            if (!showSteps) return null;
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
                      if (!next) {
                        closeSteps();
                        return;
                      }
                      setOpen(true);
                      void loadSteps();
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
                    <ActivityLog
                      activity={activity}
                      workspace={workspace}
                      peroURL={peroURL}
                      agent={agentName}
                      streaming={streaming}
                    />
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
                aria-haspopup="dialog"
                aria-busy={loadingSteps}
                onClick={() => {
                  if (loadingSteps) return;
                  if (open) closeSteps();
                  else void openSteps();
                }}
              >
                {loadingSteps && !open ? <Loader2 className="animate-spin" /> : <ListTree />}
                <span>Steps{shownSteps > 0 ? ` · ${shownSteps}` : ""}</span>
                {shownErrors > 0 && <CircleAlert className="text-destructive" />}
              </Button>
            )}
            {!showSteps && open && (
              <Modal
                label="Agent steps"
                title={
                  <>
                    <span className="text-[11px] font-semibold uppercase tracking-wider">
                      Activity
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">
                      {stats}
                    </span>
                  </>
                }
                panelClassName="max-w-2xl"
                onClose={closeSteps}
              >
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {activity.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1 text-xs">
                      {stepsError ?? "Nothing recorded for this turn."}
                    </p>
                  ) : (
                    <ActivityLog
                      activity={activity}
                      workspace={workspace}
                      peroURL={peroURL}
                      agent={agentName}
                      streaming={streaming}
                    />
                  )}
                  {stepsError && activity.length > 0 && (
                    <p className="text-destructive px-2 py-1 text-xs">{stepsError}</p>
                  )}
                </div>
                {breakdown.length > 0 && (
                  <footer className="border-border/70 flex flex-wrap items-center gap-1 border-t px-3 py-2">
                    {breakdown.map((group) => (
                      <span
                        key={group.verb}
                        className={cn(
                          "bg-muted/60 text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]",
                          group.error > 0 && "text-destructive",
                        )}
                      >
                        {group.verb} {group.count}
                      </span>
                    ))}
                    {shownErrors > 0 && (
                      <span className="text-destructive ml-auto flex items-center gap-1 text-[10px]">
                        <CircleAlert className="size-3" />
                        {shownErrors} failed
                      </span>
                    )}
                  </footer>
                )}
              </Modal>
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
    sameMessages(left.messages, right.messages)
  );
}

function sameMessages(left: Message[], right: Message[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((message, index) => message === right[index]);
}
