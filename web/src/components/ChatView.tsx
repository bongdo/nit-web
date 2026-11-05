import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  CircleAlert,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import type { Agent, Message, Model, Session } from "../lib/types";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { MessageRow } from "./MessageRow";

function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      {[0, 1].map((item) => (
        <div key={item} className="space-y-2">
          <div className="bg-muted h-3 w-24 animate-pulse rounded" />
          <div className="bg-muted h-3 w-11/12 animate-pulse rounded" />
          <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

export function ChatView({
  session,
  messages,
  loading,
  running,
  error,
  models,
  agents,
  workspace,
  onRetry,
}: {
  session: Session | null;
  messages: Message[];
  loading: boolean;
  running: boolean;
  error: string | null;
  models: Model[];
  agents: Agent[];
  workspace: string | null;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stick.current = true;
    setShowJump(false);
  };

  useEffect(() => {
    stick.current = true;
    const frame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(frame);
  }, [session?.id]);

  useEffect(() => {
    if (stick.current) {
      const frame = requestAnimationFrame(scrollToBottom);
      return () => cancelAnimationFrame(frame);
    }
  }, [messages, running]);

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="max-w-md text-center">
          <div className="bg-secondary text-secondary-foreground mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
            <Sparkles className="size-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {workspace ? "Start a new chat" : "Choose a workspace"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {workspace
              ? "Type below and the chat is created in this directory on the first message. The workspace cannot change after that."
              : "Pick a directory for this chat. Markdown, tables, code and HTML previews render here."}
          </p>
          <p className="text-muted-foreground mt-3 font-mono text-[11px]">
            {workspace ?? "no workspace"}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <Skeleton />
      </div>
    );
  }

  const lastAssistant = [...messages].reverse().find((message) => message.type === "assistant");
  const waiting = running && (!lastAssistant || messages[messages.length - 1]?.type === "user");

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        data-transcript
        className="scrollbar-thin h-full overflow-y-auto overflow-x-hidden"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight < 140;
          stick.current = nearBottom;
          setShowJump(!nearBottom);
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {error && (
            <div className="text-destructive border-destructive/30 bg-destructive/5 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap">{error}</span>
              <Button variant="ghost" size="xs" onClick={onRetry}>
                Retry
              </Button>
            </div>
          )}

          {messages.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-secondary text-secondary-foreground mb-4 flex size-11 items-center justify-center rounded-2xl">
                <MessageSquare className="size-5" />
              </div>
              <h2 className="text-lg font-semibold">New session</h2>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                Ask a question, paste a stack trace, or ask for a page you can preview.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                models={models}
                agents={agents}
                streaming={Boolean(
                  running &&
                    lastAssistant &&
                    message.id === lastAssistant.id &&
                    messages[messages.length - 1]?.id === lastAssistant.id,
                )}
              />
            ))
          )}

          {waiting && (
            <div className="text-muted-foreground flex items-center gap-2 px-1 py-4 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Working…
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            className={cn("pointer-events-auto shadow-md")}
            onClick={scrollToBottom}
          >
            <ArrowDown />
            Latest
          </Button>
        </div>
      )}
    </div>
  );
}
