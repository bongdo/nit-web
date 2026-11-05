import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitFork,
  Loader2,
  Undo2,
} from "lucide-react";
import type { Agent, Message, Model } from "../lib/types";
import { copyText } from "../lib/clipboard";
import { isPureHtml, looksLikeHtml } from "../lib/html";
import { modelLabel, replyText } from "../lib/format";
import { Button } from "./ui/button";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { Markdown } from "./Markdown";
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

export function AssistantTurn({
  messages,
  models,
  agents,
  streaming,
  actionsDisabled,
  onRevert,
  onFork,
}: {
  messages: Message[];
  models: Model[];
  agents: Agent[];
  streaming: boolean;
  actionsDisabled?: boolean;
  onRevert: (message: Message) => void;
  onFork: (message: Message) => void;
}) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  const [copied, setCopied] = useState(false);
  const last = messages[messages.length - 1];
  const content = messages.flatMap((message) => message.content ?? []);
  const activity = content.filter((part) => part.type === "reasoning" || part.type === "tool");
  const textParts = content.filter((part) => part.type === "text");
  const toolCount = activity.filter((part) => part.type === "tool").length;
  const reply = messages.map(replyText).filter(Boolean).join("\n\n");
  const agent = agents.find((item) => item.id === last?.agent);
  const model = modelLabel(last?.model, models);
  const summary = [
    activity.length > 0 ? `${activity.length} steps` : "",
    toolCount > 0 ? `${toolCount} tools` : "",
    durationLabel(messages),
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true;
      setOpen(true);
      return;
    }
    if (wasStreaming.current) {
      wasStreaming.current = false;
      setOpen(false);
    }
  }, [streaming]);

  const onCopy = async () => {
    if (await copyText(reply)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="px-1 py-3">
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
        <span className="bg-secondary text-secondary-foreground flex size-6 items-center justify-center rounded-full">
          <Bot className="size-3.5" />
        </span>
        <span className="font-medium">{agent?.name ?? last?.agent ?? "Assistant"}</span>
        {model && <span className="text-muted-foreground truncate">{model}</span>}
        {reply.trim() !== "" && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground shrink-0"
            onClick={onCopy}
            aria-label="Copy assistant reply"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
        {last && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground shrink-0"
              onClick={() => onRevert(last)}
              disabled={actionsDisabled}
              title="Revert to the prompt that produced this reply"
              aria-label="Revert to the prompt"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground shrink-0"
              onClick={() => onFork(last)}
              disabled={actionsDisabled}
              title="Fork before this reply"
              aria-label="Fork before this reply"
            >
              <GitFork />
            </Button>
          </>
        )}
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {streaming ? "running" : new Date(last?.time.created ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="min-w-0 pl-8">
        {activity.length > 0 && (
          <div className="border-border bg-card/40 my-2 overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="hover:bg-accent/40 flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {streaming ? (
                <Loader2 className="size-3.5 animate-spin text-emerald-500" />
              ) : null}
              <span className="text-muted-foreground text-[11px]">{summary}</span>
            </button>
            {open && (
              <div className="border-border space-y-1 border-t p-2">
                {activity.map((part, index) =>
                  part.type === "reasoning" ? (
                    <Reasoning
                      key={`reasoning-${index}`}
                      part={part}
                      streaming={streaming && index === activity.length - 1}
                    />
                  ) : (
                    <ToolCall key={`tool-${part.id ?? index}`} part={part} />
                  ),
                )}
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

        {content.length === 0 && streaming && (
          <div className="text-muted-foreground py-2 text-xs">Waiting for the first token…</div>
        )}
        {last?.error && (
          <div className="text-destructive border-destructive/30 bg-destructive/5 mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="whitespace-pre-wrap">
              {last.error.message ?? "The assistant failed."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
