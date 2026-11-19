import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  CircleAlert,
  FileCode2,
  Loader2,
  MessageSquare,
  Quote,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { Agent, Instance, LineRange, Message, Model, Project, Session } from "../lib/types";
import {
  isAtBottom,
  isAtTop,
  shouldLoadEarlier,
  type ScrollAnchor,
} from "../lib/scroll";
import { readFromSelection } from "../lib/speech";
import { selectionFile } from "../lib/selection";
import { cn } from "../lib/utils";
import type { TimeFormat } from "../lib/time";
import { openInApp } from "../lib/appLink";
import { useChatDictionary } from "../hooks/useChatDictionary";
import { Button } from "./ui/button";
import { AssistantTurn } from "./AssistantTurn";
import { CompactionBusy } from "./Compaction";
import { MessageRow } from "./MessageRow";
import { Scene, type SceneSetting } from "./Scene";
import { WorkspaceMenu } from "./WorkspacePicker";
import { TextSelectionMenu } from "./TextSelectionMenu";

type SelectionQuote = {
  text: string;
  x: number;
  y: number;
  messageID: string;
  block: number;
  file?: { path: string; href: string; lines?: LineRange[] };
};

function selectedFile(node: Node | null): SelectionQuote["file"] {
  return selectionFile(node);
}

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

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 10000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="chrome-sheen-error text-destructive border-destructive/30 bg-destructive/5 relative mb-4 flex items-start gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1 whitespace-pre-wrap">{error}</span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        Retry
      </Button>
      <span aria-hidden className="chrome-sheen-error-progress" />
    </div>
  );
}

function rowKey(message: Message): string {
  return message.localKey ?? message.id;
}

function findRow(rows: HTMLDivElement | null, messageID: string): HTMLElement | null {
  if (!rows) return null;
  for (const row of rows.children) {
    const element = row as HTMLElement;
    if (element.dataset.messageId === messageID) return element;
  }
  return null;
}

function lastRowBelow(rows: HTMLDivElement | null, viewport: HTMLElement): boolean {
  const last = rows?.lastElementChild as HTMLElement | null;
  if (!last) return false;
  return last.getBoundingClientRect().top >= viewport.getBoundingClientRect().bottom;
}

function rowAtTop(rows: HTMLDivElement, top: number): { row: HTMLElement; offset: number } | null {
  let low = 0;
  let high = rows.children.length - 1;
  let found: { row: HTMLElement; offset: number } | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const row = rows.children[middle] as HTMLElement;
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top) {
      found = { row, offset: rect.top - top };
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
}

export function ChatView({
  session,
  messages,
  loading,
  running,
  compacting,
  freshCompaction,
  error,
  models,
  agents,
  projects,
  recent,
  workspace,
  instance,
  instances,
  defaultInstance,
  peroURL,
  motion,
  background,
  sceneKey,
  timeFormat,
  showTime,
  onRetry,
  onRevert,
  onFork,
  onQuote,
  onPickWorkspace,
  onBrowseWorkspace,
  hasEarlier,
  loadingEarlier,
  earlierFailed,
  onLoadEarlier,
  onBottomChange,
}: {
  session: Session | null;
  messages: Message[];
  loading: boolean;
  running: boolean;
  compacting: boolean;
  freshCompaction: boolean;
  error: string | null;
  models: Model[];
  agents: Agent[];
  projects: Project[];
  recent: string[];
  workspace: string | null;
  instance: string;
  instances: Instance[];
  defaultInstance: string;
  peroURL: string;
  motion: "animated" | "static";
  background: SceneSetting;
  sceneKey: number;
  timeFormat: TimeFormat;
  showTime: boolean;
  onRetry: () => void;
  onRevert: (message: Message) => Promise<void>;
  onFork: (message: Message) => Promise<void>;
  onQuote: (text: string) => void;
  onPickWorkspace: (directory: string, instance?: string) => void;
  onBrowseWorkspace: () => void;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  earlierFailed: boolean;
  onLoadEarlier: () => void | Promise<void>;
  onBottomChange?: (atBottom: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const chasing = useRef(false);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useChatDictionary(messages, !loading);
  const anchors = useRef(new Map<string, ScrollAnchor>());
  const pendingRestore = useRef<string | null>(null);
  const settle = useRef<{ id: string; anchor: ScrollAnchor } | null>(null);
  const settleTop = useRef<number | null>(null);
  const touchY = useRef<number | null>(null);
  const earlierAnchor = useRef<{
    height: number;
    top: number;
    first: string;
    session: string;
  } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [quote, setQuote] = useState<SelectionQuote | null>(null);
  const bottom = useRef(true);
  const gestureAt = useRef(0);
  const resizeAt = useRef(0);
  const [freshRow, setFreshRow] = useState<{ id: string; session: string } | null>(null);
  const jumping = useRef(false);
  const seenSession = useRef<string | null>(null);
  const fadePending = useRef(false);
  const entrance = useRef<{
    session: string | null;
    row: string | null;
    count: number;
    ready: boolean;
  }>({ session: null, row: null, count: 0, ready: false });

  const stopScroll = useCallback(() => {
    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
    chasing.current = false;
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stopScroll();
    jumping.current = false;
    element.scrollTop = element.scrollHeight;
    stick.current = true;
    setShowJump(false);
  }, [stopScroll]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const onResize = () => {
      resizeAt.current = Date.now();
      if (!stick.current) return;
      requestAnimationFrame(() => {
        if (stick.current) scrollToBottom();
      });
    };
    window.addEventListener("resize", onResize);
    viewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      viewport?.removeEventListener("resize", onResize);
    };
  }, [scrollToBottom]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    gestureAt.current = Date.now();
    stopScroll();
    const smooth =
      motion === "animated" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    jumping.current = true;
    stick.current = true;
    setShowJump(false);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, [motion, stopScroll]);

  const scheduleScroll = useCallback(() => {
    if (scrollFrame.current !== null || !stick.current) return;
    const instant =
      motionRef.current === "static" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chasing.current = true;
    const chase = () => {
      scrollFrame.current = null;
      const element = scrollRef.current;
      if (!element || !stick.current) {
        chasing.current = false;
        return;
      }
      const target = element.scrollHeight - element.clientHeight;
      const gap = target - element.scrollTop;
      if (isAtBottom(element)) {
        chasing.current = false;
        return;
      }
      const step = instant ? gap : gap > 160 ? gap : Math.max(1, gap * 0.35);
      element.scrollTop = Math.min(target, element.scrollTop + step);
      scrollFrame.current = requestAnimationFrame(chase);
    };
    scrollFrame.current = requestAnimationFrame(chase);
  }, []);

  const requestEarlier = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !hasEarlier || loadingEarlier || loading) return;
    earlierAnchor.current = {
      height: element.scrollHeight,
      top: element.scrollTop,
      first: messagesRef.current[0]?.id ?? "",
      session: session?.id ?? "",
    };
    void onLoadEarlier();
  }, [hasEarlier, loading, loadingEarlier, onLoadEarlier, session?.id]);

  const pullEarlier = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !isAtTop(element.scrollTop)) return;
    if (
      !shouldLoadEarlier({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        hasEarlier,
        loading: loadingEarlier,
        pull: true,
      })
    ) {
      return;
    }
    requestEarlier();
  }, [hasEarlier, loadingEarlier, requestEarlier]);

  const applyAnchor = useCallback((anchor: ScrollAnchor): boolean => {
    const element = scrollRef.current;
    const row = findRow(rowsRef.current, anchor.messageID);
    if (!element || !row) return false;
    element.scrollTop +=
      row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
    settleTop.current = element.scrollTop;
    return true;
  }, []);

  const saveAnchor = (sessionID: string, nearBottom: boolean) => {
    const element = scrollRef.current;
    if (!element) return;
    if (nearBottom) {
      anchors.current.set(sessionID, { messageID: "", offset: 0, bottom: true });
      return;
    }
    const rows = rowsRef.current;
    if (!rows) return;
    const anchor = rowAtTop(rows, element.getBoundingClientRect().top);
    if (!anchor) return;
    anchors.current.set(sessionID, {
      messageID: anchor.row.dataset.messageId ?? "",
      offset: anchor.offset,
      bottom: false,
    });
  };

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      chasing.current = false;
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
      const file = selectedFile(selection.anchorNode);
      const node =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement;
      const messageID = node?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? "";
      const startNode = selection.getRangeAt(0).startContainer;
      const startElement =
        startNode instanceof Element ? startNode : startNode.parentElement;
      const rawBlock = startElement
        ?.closest("[data-speech-block]")
        ?.getAttribute("data-speech-block");
      const block = rawBlock === null || rawBlock === undefined ? -1 : Number(rawBlock);
      setQuote((current) =>
        current?.text === text &&
        current.x === x &&
        current.y === y &&
        current.messageID === messageID &&
        current.block === block &&
        current.file?.href === file?.href
          ? current
          : { text, x, y, messageID, block, file },
      );
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  useLayoutEffect(() => {
    const id = session?.id ?? null;
    pendingRestore.current = id;
    if (id && loading) anchors.current.delete(id);
  }, [session?.id]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setShowJump(!stick.current && lastRowBelow(rowsRef.current, element));
  }, [messages, session?.id]);

  useLayoutEffect(() => {
    const id = session?.id ?? null;
    if (!id) return;
    const previous = seenSession.current;
    if (previous !== id) {
      seenSession.current = id;
      if (!previous) return;
      fadePending.current = true;
    }
    if (!fadePending.current) return;
    if (loading) return;
    if (motion !== "animated") {
      fadePending.current = false;
      return;
    }
    const element = contentRef.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fadePending.current = false;
      return;
    }
    fadePending.current = false;
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 140,
      easing: "ease-out",
    });
  }, [loading, motion, session?.id]);

  useLayoutEffect(() => {
    setFreshRow(null);
  }, [motion]);

  useLayoutEffect(() => {
    const sessionID = session?.id ?? null;
    const previous = entrance.current;
    const last = messages[messages.length - 1];
    let row: string | null = last ? rowKey(last) : null;
    if (last?.type === "assistant") {
      let index = messages.length - 1;
      while (index > 0 && messages[index - 1].type === "assistant") index -= 1;
      row = messages[index] ? rowKey(messages[index]) : row;
    }
    if (!sessionID || loading) {
      entrance.current = { session: sessionID, row: null, count: 0, ready: false };
      return;
    }
    const next = { session: sessionID, row, count: messages.length, ready: true };
    if (previous.session !== sessionID || !previous.ready) {
      if (previous.session !== sessionID) setFreshRow(null);
      entrance.current = next;
      return;
    }
    entrance.current = next;
    if (!row || row === previous.row || messages.length <= previous.count) return;
    setFreshRow({ id: row, session: sessionID });
  }, [loading, messages, session?.id]);

  useEffect(() => {
    if (!freshRow) return;
    const timer = window.setTimeout(() => setFreshRow(null), 240);
    return () => window.clearTimeout(timer);
  }, [freshRow]);

  useLayoutEffect(() => {
    const id = session?.id ?? null;
    const element = scrollRef.current;
    if (!id || !element || loading || pendingRestore.current !== id) return;
    pendingRestore.current = null;
    stopScroll();
    const anchor = anchors.current.get(id);
    if (anchor && !anchor.bottom && anchor.messageID && applyAnchor(anchor)) {
      stick.current = false;
      settle.current = { id, anchor };
      setShowJump(true);
      return;
    }
    settle.current = null;
    settleTop.current = null;
    scrollToBottom();
  }, [applyAnchor, loading, scrollToBottom, session?.id, stopScroll]);

  useEffect(() => {
    if (stick.current) scheduleScroll();
  }, [messages, running, scheduleScroll]);

  useEffect(() => {
    if (loading || !hasEarlier || loadingEarlier || earlierFailed) return;
    const element = scrollRef.current;
    if (!element) return;
    if (
      shouldLoadEarlier({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        hasEarlier,
        loading: loadingEarlier,
      })
    ) {
      requestEarlier();
    }
  }, [earlierFailed, hasEarlier, loading, loadingEarlier, requestEarlier, session?.id]);

  useLayoutEffect(() => {
    const anchor = earlierAnchor.current;
    const element = scrollRef.current;
    if (!anchor || !element || loadingEarlier) return;
    if ((session?.id ?? "") !== anchor.session) {
      earlierAnchor.current = null;
      return;
    }
    if ((messages[0]?.id ?? "") === anchor.first) {
      earlierAnchor.current = null;
      return;
    }
    earlierAnchor.current = null;
    if (anchor.top > 0) {
      const delta = element.scrollHeight - anchor.height;
      if (delta > 0) element.scrollTop = anchor.top + delta;
    }
  }, [loadingEarlier, messages, session?.id]);

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
      if (stick.current) {
        scheduleScroll();
        return;
      }
      const current = settle.current;
      if (current && current.id === (session?.id ?? null)) applyAnchor(current.anchor);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [applyAnchor, session?.id, loading, scheduleScroll]);

  const fresh =
    motion === "animated" && freshRow && freshRow.session === session?.id ? freshRow.id : null;

  const wasRunning = useRef(running);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (wasRunning.current && !running) {
      setAnnouncement(error ? "Run failed" : "Reply finished");
    }
    wasRunning.current = running;
  }, [running, error]);

  const rows = useMemo(() => {
    const items: ReactNode[] = [];
    let lastUserID: string | undefined;
    let lastCompactionId: string | null = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!lastUserID && message.type === "user") lastUserID = message.id;
      if (!lastCompactionId && message.type === "compaction") lastCompactionId = message.id;
      if (lastUserID && lastCompactionId) break;
    }
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.type === "assistant") {
        const group = [message];
        while (messages[index + 1]?.type === "assistant") {
          index += 1;
          group.push(messages[index]);
        }
        items.push(
          <div
            key={`turn-${message.id}`}
            data-message-id={message.id}
            className={message.id === fresh ? "message-enter" : undefined}
          >
            <AssistantTurn
              messages={group}
              sessionID={session?.id ?? ""}
              instance={session?.instance ?? instance}
              models={models}
              agents={agents}
              workspace={workspace}
              peroURL={peroURL}
              streaming={Boolean(running && index === messages.length - 1)}
              timeFormat={timeFormat}
              showTime={showTime}
            />
          </div>,
        );
        continue;
      }
      const key = rowKey(message);
      items.push(
        <div
          key={key}
          data-message-id={message.id}
          className={key === fresh ? "message-enter" : undefined}
        >
          <MessageRow
            message={message}
            running={running}
            alwaysShowActions={message.id === lastUserID}
            autoOpen={freshCompaction && message.id === lastCompactionId}
            directory={workspace}
            peroURL={peroURL}
            sessionID={session?.id}
            instance={session?.instance ?? instance}
            timeFormat={timeFormat}
            showTime={showTime}
            onRevert={onRevert}
            onFork={onFork}
          />
        </div>,
      );
    }
    return items;
  }, [
    agents,
    fresh,
    freshCompaction,
    instance,
    messages,
    models,
    onFork,
    onRevert,
    peroURL,
    running,
    session?.id,
    timeFormat,
    showTime,
    workspace,
  ]);

  const scene = (
    <Scene
      key={sceneKey}
      variant={background}
      motion={motion}
      paused={Boolean(session)}
      className={cn(
        "transition-opacity duration-500 ease-out motion-reduce:transition-none starting:opacity-0",
        session ? "opacity-0" : "opacity-100",
      )}
    />
  );

  if (!session) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        {scene}
        <div className="relative max-w-md text-center">
          <div
            className={cn(
              "bg-secondary text-secondary-foreground mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl",
              motion === "animated" && "chrome-sheen-empty",
            )}
          >
            <Sparkles className="text-spark size-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {workspace ? "Start a new chat" : "Choose a workspace"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {workspace
              ? "Ask anything or attach files. Code, tables and HTML previews render inline."
              : "Pick a directory for this chat. Markdown, tables, code and HTML previews render here."}
          </p>
          <div className="mt-3 flex justify-center">
            {workspace ? (
              <WorkspaceMenu
                projects={projects}
                recent={recent}
                current={workspace}
                instance={instance}
                instances={instances}
                defaultInstance={defaultInstance}
                onPick={onPickWorkspace}
                onBrowse={onBrowseWorkspace}
              />
            ) : (
              <span className="text-muted-foreground font-mono text-[11px]">no workspace</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {scene}
        <div className="relative">
          <Skeleton />
        </div>
      </div>
    );
  }

  const lastAssistant = [...messages].reverse().find((message) => message.type === "assistant");
  const runningCompaction = messages.some(
    (message) => message.type === "compaction" && message.status === "running",
  );
  const waiting =
    running && !compacting && (!lastAssistant || messages[messages.length - 1]?.type === "user");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {scene}
      {loadingEarlier && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <span className="bg-background/85 text-muted-foreground border-border flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm backdrop-blur">
            <Loader2 className="size-3 animate-spin" />
            Loading earlier…
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        data-transcript
        className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable]"
        onWheel={(event) => {
          jumping.current = false;
          gestureAt.current = Date.now();
          stopScroll();
          if (event.deltaY < 0) pullEarlier();
        }}
        onPointerDown={(event) => {
          jumping.current = false;
          gestureAt.current = Date.now();
          if (event.target === event.currentTarget) stopScroll();
        }}
        onTouchStart={(event) => {
          jumping.current = false;
          gestureAt.current = Date.now();
          touchY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          gestureAt.current = Date.now();
          stopScroll();
          const y = event.touches[0]?.clientY;
          if (y !== undefined && touchY.current !== null && y > touchY.current) {
            pullEarlier();
          }
          if (y !== undefined) touchY.current = y;
        }}
        onTouchEnd={() => {
          touchY.current = null;
        }}
        onKeyDown={(event) => {
          jumping.current = false;
          gestureAt.current = Date.now();
          stopScroll();
          if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
            pullEarlier();
          }
        }}
        onScroll={(event) => {
          if (chasing.current) return;
          const element = event.currentTarget;
          const nearBottom = isAtBottom(element);
          if (jumping.current) {
            if (!nearBottom) {
              setQuote(null);
              return;
            }
            jumping.current = false;
          }
          if (nearBottom !== bottom.current) {
            bottom.current = nearBottom;
            const now = Date.now();
            if (now - resizeAt.current > 250 && now - gestureAt.current < 600) {
              onBottomChange?.(nearBottom);
            }
          }
          stick.current = nearBottom;
          setShowJump(lastRowBelow(rowsRef.current, element));
          setQuote(null);
          if (earlierAnchor.current) earlierAnchor.current.top = element.scrollTop;
          const programmatic =
            settleTop.current !== null && Math.abs(element.scrollTop - settleTop.current) <= 2;
          if (!programmatic) settle.current = null;
          settleTop.current = null;
          if (session?.id) saveAnchor(session.id, nearBottom);
          if (
            shouldLoadEarlier({
              scrollTop: element.scrollTop,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              hasEarlier,
              loading: loadingEarlier,
            })
          ) {
            requestEarlier();
          }
        }}
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 pt-16 pb-6">
          <span className="sr-only" role="status" aria-live="polite">
            {announcement}
          </span>
          {error && <ErrorBanner key={error} error={error} onRetry={onRetry} />}

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
            <div ref={rowsRef}>{rows}</div>
          )}

          {compacting && !runningCompaction && <CompactionBusy />}

          {waiting && (
            <div className="text-muted-foreground flex items-center gap-2 px-1 py-4 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Working…
            </div>
          )}

          <div aria-hidden style={{ height: "var(--dock, 0px)" }} />
        </div>
      </div>

      <TextSelectionMenu container={scrollRef} onQuote={onQuote} />

      {showJump && (
        <div className="pointer-events-none absolute right-3 bottom-[calc(var(--dock,0px)+0.75rem)] flex justify-end">
          <Button
            variant="secondary"
            size="icon"
            className={cn(
              "pointer-events-auto relative rounded-full shadow-md",
              motion === "animated" && "chrome-sheen-latest",
            )}
            onClick={jumpToLatest}
            aria-label="Jump to latest"
            title="Jump to latest"
          >
            <ArrowDown />
          </Button>
        </div>
      )}

      {quote && (
        <div
          className="fixed z-50 flex items-center gap-1"
          style={{ left: quote.x, top: quote.y - 8, transform: "translate(-50%, -100%)" }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            variant="secondary"
            size="xs"
            className="shadow-md"
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
          <Button
            variant="secondary"
            size="xs"
            className="shadow-md"
            onClick={() => {
              readFromSelection(quote.messageID, quote.text, quote.block);
              window.getSelection()?.removeAllRanges();
              setQuote(null);
            }}
            aria-label="Read from here"
            title="Read from here to the end"
          >
            <Volume2 />
            Read
          </Button>
          {quote.file && (
            <Button
              variant="secondary"
              size="xs"
              className="shadow-md"
              onClick={() => {
                const file = quote.file!;
                openInApp({ app: "pero", path: file.path, lines: file.lines }, file.href);
                window.getSelection()?.removeAllRanges();
                setQuote(null);
              }}
              aria-label={`Open ${quote.file.path} in pero`}
              title={`Open ${quote.file.path} in pero`}
            >
              <FileCode2 />
              pero
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
