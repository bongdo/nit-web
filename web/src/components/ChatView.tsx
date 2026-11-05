import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  CircleAlert,
  Loader2,
  MessageSquare,
  Quote,
  Sparkles,
} from "lucide-react";
import type { Agent, Message, Model, Session } from "../lib/types";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { AssistantTurn } from "./AssistantTurn";
import { MessageRow } from "./MessageRow";
import { Scene, type SceneSetting } from "./Scene";

function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-16 pb-8">
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
  motion,
  background,
  onRetry,
  onRevert,
  onFork,
  onQuote,
}: {
  session: Session | null;
  messages: Message[];
  loading: boolean;
  running: boolean;
  error: string | null;
  models: Model[];
  agents: Agent[];
  workspace: string | null;
  motion: "animated" | "static";
  background: SceneSetting;
  onRetry: () => void;
  onRevert: (message: Message) => void;
  onFork: (message: Message) => void;
  onQuote: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stick.current = true;
    setShowJump(false);
  }, []);

  const scheduleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      const element = scrollRef.current;
      if (
        !text ||
        !element ||
        !selection?.anchorNode ||
        !element.contains(selection.anchorNode) ||
        selection.rangeCount === 0
      ) {
        setQuote(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setQuote(null);
        return;
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      setQuote((current) =>
        current?.text === text && current.x === x && current.y === y ? current : { text, x, y },
      );
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  useEffect(() => {
    stick.current = true;
    scheduleScroll();
  }, [session?.id]);

  useEffect(() => {
    if (stick.current) scheduleScroll();
  }, [messages, running]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stick.current) scheduleScroll();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [session?.id, loading]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stick.current) scheduleScroll();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [session?.id, loading]);

  if (!session) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <Scene variant={background} motion={motion} />
        <div className="relative max-w-md text-center">
          <div className="bg-secondary text-secondary-foreground mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
            <Sparkles className="text-spark size-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {workspace ? "Start a new chat" : "Choose a workspace"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {workspace
              ? "Ask anything, attach files or dictate. Code, tables and HTML previews render inline."
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

  const rows: ReactNode[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "assistant") {
      const group = [message];
      while (messages[index + 1]?.type === "assistant") {
        index += 1;
        group.push(messages[index]);
      }
      rows.push(
        <AssistantTurn
          key={`turn-${message.id}`}
          messages={group}
          models={models}
          agents={agents}
          streaming={Boolean(running && index === messages.length - 1)}
          actionsDisabled={running}
          onRevert={onRevert}
          onFork={onFork}
        />,
      );
      continue;
    }
    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        models={models}
        agents={agents}
        actionsDisabled={running}
        onRevert={onRevert}
        onFork={onFork}
        streaming={false}
      />,
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-transcript
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable]"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight < 140;
          stick.current = nearBottom;
          setShowJump(!nearBottom);
          setQuote(null);
        }}
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 pt-16 pb-6">
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
              <h2 className="text-lg font-semibold">New chat</h2>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                Ask a question, paste a stack trace, or ask for a page you can preview.
              </p>
            </div>
          ) : (
            rows
          )}

          {waiting && (
            <div className="text-muted-foreground flex items-center gap-2 px-1 py-4 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Working…
            </div>
          )}

          <div aria-hidden style={{ height: "var(--dock, 0px)" }} />
        </div>
      </div>

      {showJump && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--dock,0px)+0.75rem)] flex justify-center">
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

      {quote && (
        <Button
          variant="secondary"
          size="xs"
          className="fixed z-50 shadow-md"
          style={{ left: quote.x, top: quote.y - 8, transform: "translate(-50%, -100%)" }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQuote(quote.text);
            window.getSelection()?.removeAllRanges();
            setQuote(null);
          }}
          aria-label="Quote selection"
          title="Quote in the composer"
        >
          <Quote />
          Quote
        </Button>
      )}
    </div>
  );
}
