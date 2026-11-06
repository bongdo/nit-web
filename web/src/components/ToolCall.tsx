import { memo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Loader2,
} from "lucide-react";
import type { ToolContent, ToolPart } from "../lib/types";
import { toolSummary } from "../lib/activity";
import { attachmentHref, attachmentKind } from "../lib/attachments";

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

export const ToolCall = memo(function ToolCall({
  part,
  cwd,
  onLoad,
}: {
  part: ToolPart;
  cwd?: string | null;
  onLoad?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { verb, target } = toolSummary(part, cwd);
  const status = part.state.status;
  const content = part.state.content ?? [];

  return (
    <details
      className="group"
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        if (!next || !part.light || !onLoad || loading) return;
        setLoading(true);
        Promise.resolve(onLoad()).finally(() => setLoading(false));
      }}
    >
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1 text-[11px] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <StatusIcon status={status} />
        <span className="shrink-0 font-medium">{verb}</span>
        {target && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">{target}</span>
        )}
      </summary>
      <div className="border-border mr-2 mb-1 ml-7 space-y-2 border-l-2 py-1 pl-3 text-xs">
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
        {loading && <p className="text-muted-foreground">Loading output…</p>}
        {status === "completed" && content.length === 0 && !part.light && (
          <p className="text-muted-foreground">No output</p>
        )}
        {status === "completed" && content.length === 0 && part.light && !loading && (
          <p className="text-muted-foreground">Open to load output</p>
        )}
        {part.state.error && (
          <p className="text-destructive whitespace-pre-wrap">
            {part.state.error.message ?? "Tool failed"}
          </p>
        )}
      </div>
    </details>
  );
});
