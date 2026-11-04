import type { ReactNode } from "react";
import { Bot, CircleAlert, Terminal } from "lucide-react";
import type { Agent, Message, Model } from "../lib/types";
import { isPureHtml, looksLikeHtml } from "../lib/html";
import { modelLabel } from "../lib/format";
import { Badge } from "./ui/badge";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { Markdown } from "./Markdown";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Note({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground my-3 text-center text-xs">{children}</div>;
}

export function MessageRow({
  message,
  models,
  agents,
  streaming,
}: {
  message: Message;
  models: Model[];
  agents: Agent[];
  streaming: boolean;
}) {
  if (message.type === "user") {
    return (
      <div className="flex justify-end px-1 py-2">
        <div className="bg-secondary max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5">
          <Markdown text={message.text ?? ""} />
          <div className="text-muted-foreground mt-1 text-right text-[10px]">
            {timeLabel(message.time.created)}
          </div>
        </div>
      </div>
    );
  }

  if (message.type === "shell") {
    return (
      <div className="border-border bg-card my-3 overflow-hidden rounded-lg border">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2 text-xs">
          <Terminal className="text-muted-foreground size-3.5" />
          <code className="min-w-0 flex-1 truncate font-mono">{message.command}</code>
          <Badge variant="outline">{message.status ?? "shell"}</Badge>
        </div>
        {message.output?.output && (
          <pre className="scrollbar-thin max-h-72 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap">
            {message.output.output}
          </pre>
        )}
      </div>
    );
  }

  if (message.type === "compaction") {
    return (
      <details className="border-border bg-card/50 my-3 rounded-lg border px-3 py-2 text-xs">
        <summary className="text-muted-foreground cursor-pointer list-none">
          Context compacted{message.reason ? ` (${message.reason})` : ""}
        </summary>
        {message.summary && (
          <div className="markdown text-muted-foreground mt-2 border-l-2 pl-3">
            <Markdown text={message.summary} />
          </div>
        )}
      </details>
    );
  }

  if (message.type === "idle") {
    if (message.outcome === "failed" && message.error?.message) {
      return (
        <div className="text-destructive mx-1 my-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{message.error.message}</span>
        </div>
      );
    }
    return null;
  }

  if (message.type === "system" || message.type === "synthetic" || message.type === "skill") {
    const text = message.text ?? message.description;
    return text ? <Note>{text}</Note> : null;
  }

  if (message.type !== "assistant") {
    return null;
  }

  const content = message.content ?? [];
  const lastIndex = content.length - 1;
  const agent = agents.find((item) => item.id === message.agent);
  const model = modelLabel(message.model, models);

  return (
    <div className="px-1 py-3">
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
        <span className="bg-secondary text-secondary-foreground flex size-6 items-center justify-center rounded-full">
          <Bot className="size-3.5" />
        </span>
        <span className="font-medium">{agent?.name ?? message.agent ?? "Assistant"}</span>
        {model && <span className="text-muted-foreground truncate">{model}</span>}
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {streaming ? "streaming" : timeLabel(message.time.created)}
        </span>
      </div>
      <div className="min-w-0 pl-8">
        {content.map((part, index) => {
          if (part.type === "reasoning") {
            return (
              <Reasoning
                key={`reasoning-${part.ordinal ?? index}`}
                part={part}
                streaming={streaming && index === lastIndex}
              />
            );
          }
          if (part.type === "tool") {
            return <ToolCall key={`tool-${part.id}`} part={part} />;
          }
          const pureHtml = isPureHtml(part.text);
          return (
            <div key={`text-${part.ordinal ?? index}`}>
              {pureHtml ? (
                <HtmlMessagePreview source={part.text} />
              ) : (
                <>
                  <Markdown text={part.text} />
                  {looksLikeHtml(part.text) && <HtmlMessagePreview source={part.text} />}
                </>
              )}
              {streaming && index === lastIndex && <span className="stream-caret" />}
            </div>
          );
        })}
        {content.length === 0 && streaming && (
          <div className="text-muted-foreground py-2 text-xs">Waiting for the first token…</div>
        )}
        {message.error && (
          <div className="text-destructive border-destructive/30 bg-destructive/5 mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">
              {message.error.message ?? "The assistant failed."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
