import { memo, useState, type ReactNode } from "react";
import { CircleAlert, Copy, GitFork, Loader2, Terminal, Undo2 } from "lucide-react";
import type { Message, UserFile } from "../lib/types";
import { attachmentHref } from "../lib/attachments";
import { copyText } from "../lib/clipboard";
import { timeLabel, type TimeFormat } from "../lib/time";
import { AttachmentPreview } from "./Attachment";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CompactionRow } from "./Compaction";
import { MarkdownLazy } from "./MarkdownLazy";

function FilePreview({ file }: { file: UserFile }) {
  const href = attachmentHref(file);
  const name = file.name ?? "file";
  if (!href) {
    return (
      <span className="border-border bg-background/60 truncate rounded-md border px-2 py-1 text-[11px]">
        {name}
      </span>
    );
  }
  return <AttachmentPreview name={name} href={href} mime={file.mime} bytes={file.bytes} />;
}

function Note({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground my-3 text-center text-xs">{children}</div>;
}

export const MessageRow = memo(function MessageRow({
  message,
  running,
  alwaysShowActions,
  autoOpen,
  directory,
  peroURL,
  timeFormat,
  showTime,
  onRevert,
  onFork,
}: {
  message: Message;
  running?: boolean;
  alwaysShowActions?: boolean;
  autoOpen?: boolean;
  directory?: string | null;
  peroURL: string;
  timeFormat: TimeFormat;
  showTime: boolean;
  onRevert: (message: Message) => Promise<void>;
  onFork: (message: Message) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"revert" | "fork" | null>(null);

  const act = async (kind: "revert" | "fork", run: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  if (message.type === "user") {
    return (
      <div className="group flex justify-end px-1 py-2">
        <div className="max-w-[85%]">
          {message.delivery && (
            <div className="text-muted-foreground mb-1 flex items-center justify-end gap-1 text-[10px]">
              <span aria-hidden>↳</span>
              <span>
                {message.delivery === "steer"
                  ? "steered into the run above"
                  : "queued · answered after this run"}
              </span>
            </div>
          )}
          <div
            className={`bg-secondary rounded-2xl rounded-br-sm px-4 pt-2 pb-2.5${
              message.delivery ? " border-border border border-dashed" : ""
            }`}
          >
            {message.files && message.files.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                {message.files.map((file, index) => (
                  <FilePreview key={`${file.uri}-${index}`} file={file} />
                ))}
              </div>
            )}
            <MarkdownLazy text={message.text ?? ""} directory={directory} peroURL={peroURL} />
            {showTime && (
              <div className="text-muted-foreground mt-1 text-right text-[10px]">
                {timeLabel(message.time.created, timeFormat)}
              </div>
            )}
          </div>
          <div
            className={`message-actions mt-1 flex justify-end gap-0.5 pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100${
              alwaysShowActions
                ? " any-pointer-coarse:pointer-events-auto any-pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                : ""
            }`}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              title="Copy message"
              aria-label="Copy message"
              onClick={() => void copyText(message.text ?? "")}
            >
              <Copy />
            </Button>
            <span
              className="inline-flex"
              title={running ? "Stop the run first" : undefined}
            >
              <Button
                variant="ghost"
                size="icon-xs"
                title={
                  running
                    ? "Stop the run first"
                    : busy === "revert"
                      ? "Reverting…"
                      : "Revert and edit this message"
                }
                aria-label={
                  running
                    ? "Revert and edit this message — stop the run first"
                    : busy === "revert"
                      ? "Reverting…"
                      : "Revert and edit this message"
                }
                disabled={running || busy !== null}
                onClick={() => void act("revert", () => onRevert(message))}
              >
                {busy === "revert" ? <Loader2 className="animate-spin" /> : <Undo2 />}
              </Button>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              title={busy === "fork" ? "Forking…" : "Fork before this message"}
              aria-label={busy === "fork" ? "Forking…" : "Fork before this message"}
              disabled={busy !== null}
              onClick={() => void act("fork", () => onFork(message))}
            >
              {busy === "fork" ? <Loader2 className="animate-spin" /> : <GitFork />}
            </Button>
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
    return <CompactionRow message={message} autoOpen={autoOpen} />;
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
    const label =
      message.type === "skill"
        ? `Skill ${message.name ?? ""}`.trim()
        : (message.description ?? (message.type === "system" ? "Instructions updated" : ""));
    return label ? <Note>{label}</Note> : null;
  }

  return null;
});
