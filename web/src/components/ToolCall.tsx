import { memo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Loader2,
  Wrench,
} from "lucide-react";
import type { ToolContent, ToolPart } from "../lib/types";
import { attachmentHref, attachmentKind } from "../lib/attachments";
import { cn } from "../lib/utils";

function summarize(input: unknown): string {
  if (typeof input === "string") return input.replace(/\s+/g, " ").slice(0, 120);
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.command === "string") return record.command.replace(/\s+/g, " ").slice(0, 120);
    if (typeof record.path === "string") return record.path;
    try {
      return JSON.stringify(input).slice(0, 120);
    } catch {
      return "";
    }
  }
  return "";
}

function StatusIcon({ status }: { status: ToolPart["state"]["status"] }) {
  if (status === "streaming" || status === "running") {
    return <Loader2 className="text-muted-foreground size-3.5 animate-spin" />;
  }
  if (status === "completed") return <Check className="size-3.5 text-emerald-500" />;
  if (status === "error") return <AlertCircle className="text-destructive size-3.5" />;
  return <Circle className="size-3.5" />;
}

function ContentItem({ content }: { content: ToolContent }) {
  const source = content.uri ?? content.url;
  const href = source
    ? attachmentHref({ uri: source, mime: content.mime, name: content.name })
    : undefined;
  const name = content.name ?? source ?? "";
  if (content.type === "file" && href) {
    if (attachmentKind({ name, mime: content.mime }) === "image") {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="block">
          <img
            src={href}
            alt="Tool output"
            loading="lazy"
            className="border-border max-h-72 max-w-full rounded-md border object-contain"
          />
        </a>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-foreground underline underline-offset-4"
      >
        {name}
      </a>
    );
  }
  return <span className="whitespace-pre-wrap">{content.text ?? source ?? ""}</span>;
}

export const ToolCall = memo(function ToolCall({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const summary = summarize(part.state.input);
  const status = part.state.status;
  const content = part.state.content ?? [];

  return (
    <details
      className="border-border bg-card/60 group my-2 overflow-hidden rounded-lg border"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-open:rotate-90" />
        <StatusIcon status={status} />
        <Wrench className="text-muted-foreground size-3.5" />
        <span className="font-mono font-medium">{part.name}</span>
        {summary && (
          <span className="text-muted-foreground truncate font-mono text-[11px]">{summary}</span>
        )}
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px] uppercase tracking-wide">
          {status}
        </span>
      </summary>
      <div className="border-border space-y-2 border-t px-3 py-2.5 text-xs">
        {part.state.input !== undefined && part.state.input !== "" && (
          <pre className="bg-muted/50 scrollbar-thin max-h-48 overflow-auto rounded-md p-2 font-mono text-[11px] whitespace-pre-wrap">
            {typeof part.state.input === "string"
              ? part.state.input
              : JSON.stringify(part.state.input, null, 2)}
          </pre>
        )}
        {content.length > 0 && (
          <div className="scrollbar-thin max-h-80 space-y-2 overflow-auto">
            {content.map((item, index) => (
              <ContentItem key={index} content={item} />
            ))}
          </div>
        )}
        {status === "completed" && content.length === 0 && (
          <p className="text-muted-foreground">No output</p>
        )}
        {part.state.error && (
          <p className={cn("text-destructive whitespace-pre-wrap")}>
            {part.state.error.message ?? "Tool failed"}
          </p>
        )}
      </div>
    </details>
  );
});
