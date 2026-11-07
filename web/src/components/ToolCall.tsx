import { memo, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Loader2,
} from "lucide-react";
import type { ToolContent, ToolPart } from "../lib/types";
import { toolSummary } from "../lib/activity";
import { editedFiles } from "../lib/diff";
import { attachmentHref } from "../lib/attachments";
import { cn } from "../lib/utils";
import { AttachmentPreview } from "./Attachment";
import { FileChips } from "./FileChips";

function StatusIcon({ status }: { status: ToolPart["state"]["status"] }) {
  if (status === "streaming" || status === "running") {
    return <Loader2 className="text-muted-foreground size-3.5 animate-spin" />;
  }
  if (status === "completed") {
    return <Check className="row-sheen-tool-check size-3.5 text-success" />;
  }
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
    return <AttachmentPreview name={name} href={href} mime={content.mime} />;
  }
  return <span className="whitespace-pre-wrap">{content.text ?? source ?? ""}</span>;
}

export const ToolCall = memo(function ToolCall({
  part,
  cwd,
  peroURL,
  onLoad,
}: {
  part: ToolPart;
  cwd?: string | null;
  peroURL: string;
  onLoad?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settle, setSettle] = useState<"done" | "error" | null>(null);
  const { verb, target } = toolSummary(part, cwd);
  const files = editedFiles(part);
  const status = part.state.status;
  const content = part.state.content ?? [];
  const active = status === "running" || status === "streaming";
  const wasActive = useRef(active);

  useEffect(() => {
    if (active) {
      setSettle(null);
      wasActive.current = true;
      return;
    }
    if (wasActive.current && (status === "completed" || status === "error")) {
      setSettle(status === "completed" ? "done" : "error");
    }
    wasActive.current = false;
  }, [active, status]);

  return (
    <details
      className={cn(
        "group",
        active && "row-sheen-tool-live",
        !active && settle === "done" && "row-sheen-tool-done",
        !active && settle === "error" && "row-sheen-tool-error",
      )}
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        if (!next || !part.light || !onLoad || loading) return;
        setLoading(true);
        Promise.resolve()
          .then(() => onLoad())
          .finally(() => setLoading(false));
      }}
    >
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1 text-[11px] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <StatusIcon status={status} />
        <span className="shrink-0 font-medium">{verb}</span>
        {files.length > 0 ? (
          <span className="min-w-0 flex-1 overflow-hidden">
            <FileChips files={files} base={peroURL} max={3} />
          </span>
        ) : target ? (
          <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">{target}</span>
        ) : null}
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
