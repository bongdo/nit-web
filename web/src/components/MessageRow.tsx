import { memo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  Copy,
  FileIcon,
  FileText,
  GitFork,
  Terminal,
  Undo2,
} from "lucide-react";
import type { Agent, Message, Model, UserFile } from "../lib/types";
import { attachmentHref, attachmentKind } from "../lib/attachments";
import { copyText } from "../lib/clipboard";
import { isPureHtml, looksLikeHtml } from "../lib/html";
import { formatBytes, modelLabel, replyText } from "../lib/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CompactionRow } from "./Compaction";
import { HtmlMessagePreview } from "./HtmlMessagePreview";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function PdfPreview({ href, name }: { href: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border bg-background/60 col-span-2 overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
        <FileText className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-muted-foreground shrink-0 uppercase">PDF</span>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
        >
          {open ? "Hide" : "Preview"}
        </button>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
        >
          Open
        </a>
      </div>
      {open && <iframe src={href} title={name} className="border-border h-96 w-full border-t" />}
    </div>
  );
}

function FilePreview({ file }: { file: UserFile }) {
  const href = attachmentHref(file);
  const name = file.name ?? "file";
  const kind = attachmentKind(file);
  if (kind === "pdf" && href) return <PdfPreview href={href} name={name} />;
  if (!href) {
    return (
      <span className="border-border bg-background/60 truncate rounded-md border px-2 py-1 text-[11px]">
        {name}
      </span>
    );
  }
  if (kind === "image") {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="block">
        <img
          src={href}
          alt={name}
          loading="lazy"
          className="border-border max-h-56 w-full rounded-md border object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="border-border bg-background/60 flex items-center gap-1.5 truncate rounded-md border px-2 py-1 text-[11px]"
    >
      <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
      {file.bytes ? (
        <span className="text-muted-foreground shrink-0">{formatBytes(file.bytes)}</span>
      ) : null}
    </a>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground my-3 text-center text-xs">{children}</div>;
}

export const MessageRow = memo(function MessageRow({
  message,
  models,
  agents,
  streaming,
  actionsDisabled,
  autoOpen,
  onRevert,
  onFork,
  onLoadMessage,
}: {
  message: Message;
  models: Model[];
  agents: Agent[];
  streaming: boolean;
  actionsDisabled?: boolean;
  autoOpen?: boolean;
  onRevert: (message: Message) => void;
  onFork: (message: Message) => void;
  onLoadMessage?: (messageID: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  if (message.type === "user") {
    return (
      <div className="group flex justify-end px-1 py-2">
        <div className="max-w-[85%]">
          <div className="bg-secondary rounded-2xl rounded-br-sm px-4 py-2.5">
            {message.files && message.files.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                {message.files.map((file, index) => (
                  <FilePreview key={`${file.uri}-${index}`} file={file} />
                ))}
              </div>
            )}
            <Markdown text={message.text ?? ""} />
            <div className="text-muted-foreground mt-1 text-right text-[10px]">
              {timeLabel(message.time.created)}
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              title="Copy message"
              aria-label="Copy message"
              onClick={() => void copyText(message.text ?? "")}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Revert and edit this message"
              aria-label="Revert and edit this message"
              disabled={actionsDisabled}
              onClick={() => onRevert(message)}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Fork before this message"
              aria-label="Fork before this message"
              disabled={actionsDisabled}
              onClick={() => onFork(message)}
            >
              <GitFork />
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

  if (message.type !== "assistant") {
    return null;
  }

  const content = message.content ?? [];
  const lastIndex = content.length - 1;
  const agent = agents.find((item) => item.id === message.agent);
  const model = modelLabel(message.model, models);
  const reply = replyText(message);

  const onCopyReply = async () => {
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
        <span className="font-medium">{agent?.name ?? message.agent ?? "Assistant"}</span>
        {model && <span className="text-muted-foreground truncate">{model}</span>}
        {reply.trim() !== "" && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground shrink-0"
            onClick={onCopyReply}
            aria-label="Copy assistant reply"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground shrink-0"
          onClick={() => onRevert(message)}
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
          onClick={() => onFork(message)}
          disabled={actionsDisabled}
          title="Fork before this reply"
          aria-label="Fork before this reply"
        >
          <GitFork />
        </Button>
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {streaming ? "streaming" : timeLabel(message.time.created)}
        </span>
      </div>
      <div className="min-w-0 pl-8">
        {content.map((part, index) => {
          const onLoad =
            onLoadMessage && !streaming && "light" in part && part.light
              ? () => onLoadMessage(message.id)
              : undefined;
          if (part.type === "reasoning") {
            return (
              <Reasoning
                key={`reasoning-${part.ordinal ?? index}`}
                part={part}
                streaming={streaming && index === lastIndex}
                onLoad={onLoad}
              />
            );
          }
          if (part.type === "tool" && part.name === "question") {
            return <QuestionCard key={`question-${part.id}`} part={part} />;
          }
          if (part.type === "tool") {
            return <ToolCall key={`tool-${part.id}`} part={part} onLoad={onLoad} />;
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
});
