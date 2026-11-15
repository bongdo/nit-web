import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileCode2,
  Folder,
  Layers,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Terminal,
} from "lucide-react";
import type { Session } from "../lib/types";
import { basename, formatCost, formatRelative, sessionRunning } from "../lib/format";
import { peroHref, termHref } from "../lib/diff";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { SubagentMenu } from "./SubagentMenu";
import { WorkspaceLinks } from "./WorkspaceLinks";

function ContextMeter({ value, session }: { value: number; session?: string }) {
  const previous = useRef<number | null>(null);
  const scope = useRef(session);
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    if (scope.current !== session) {
      scope.current = session;
      previous.current = value;
      return;
    }
    const last = previous.current;
    previous.current = value;
    if (last !== null && last - value >= 8) setSweep((count) => count + 1);
  }, [session, value]);

  return (
    <span
      role="progressbar"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn(
        "chrome-sheen-context bg-muted-foreground/20 relative inline-flex h-[3px] w-10 shrink-0 overflow-hidden rounded-full",
        value > 80 && "chrome-sheen-context-hot",
      )}
    >
      <span
        className="chrome-sheen-context-fill h-full w-full rounded-full"
        style={{ transform: `scaleX(${value / 100})` }}
      />
      {sweep > 0 && <span key={sweep} aria-hidden className="chrome-sheen-context-sweep" />}
    </span>
  );
}

type SessionInfoProps = {
  session: Session | null;
  directory?: string | null;
  contextPercent?: number | null;
  cost?: number;
  estimatedCost?: boolean;
};

function SessionTitle({ session, className }: { session: Session | null; className?: string }) {
  const title = session?.title?.trim() || (session ? "New chat" : "nit-gui");
  return (
    <h1 className={cn("truncate text-[13px] font-semibold leading-tight", className)}>{title}</h1>
  );
}

function SessionMeta({
  session,
  directory: fallbackDirectory,
  contextPercent,
  cost,
  estimatedCost,
  className,
}: SessionInfoProps & { className?: string }) {
  const directory = session?.location?.directory ?? fallbackDirectory;
  return (
    <div
      className={cn(
        "text-muted-foreground flex min-w-0 items-center gap-1 text-[10px] leading-tight",
        className,
      )}
    >
      <Folder className="size-3 shrink-0" />
      <span className="truncate" title={directory ?? undefined}>
        {directory ? basename(directory) : "no directory"}
      </span>
      {contextPercent != null && (
        <span className="flex shrink-0 items-center gap-1" title="Context used">
          <span>· ctx {contextPercent}%</span>
          <ContextMeter value={contextPercent} session={session?.id} />
        </span>
      )}
      {(cost ?? 0) > 0 && (
        <span className="shrink-0" title={estimatedCost ? "Estimated cost" : "Session cost"}>
          · {estimatedCost ? "~" : ""}
          {formatCost(cost)}
        </span>
      )}
    </div>
  );
}

export function SessionPill({ className, ...info }: SessionInfoProps & { className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-hidden px-1 py-1", className)}>
      <SessionTitle session={info.session} />
      <SessionMeta {...info} />
    </div>
  );
}

function MobileMenu({
  directory,
  termURL,
  peroURL,
  transport,
  subagents,
  parent,
  inlineLinks,
  onOpenSubagent,
  onBack,
}: {
  directory?: string | null;
  termURL: string;
  peroURL: string;
  transport: string;
  subagents: Session[];
  parent?: Session | null;
  inlineLinks: boolean;
  onOpenSubagent: (session: Session) => void;
  onBack: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sorted = [...subagents].sort((a, b) => {
    const running = Number(sessionRunning(b)) - Number(sessionRunning(a));
    return running || b.time.updated - a.time.updated;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const links = transport === "local" && Boolean(directory);
  if (!parent && subagents.length === 0 && (inlineLinks || !links)) return null;

  return (
    <div ref={root} className="pointer-events-auto relative md:hidden">
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-9"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Session menu"
        title="Session menu"
      >
        <span className="relative inline-flex">
          <MoreHorizontal />
          {subagents.length > 0 && (
            <span className="bg-spark text-background absolute -top-1.5 -right-2 min-w-3.5 rounded-full px-0.5 text-center text-[8px] leading-3.5 tabular-nums">
              {subagents.length}
            </span>
          )}
        </span>
      </Button>
      {open && (
        <div
          role="menu"
          className="overlay-popover border-border bg-popover absolute top-full right-0 z-40 mt-1 max-h-[70dvh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border p-1 shadow-lg"
        >
          {parent && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onBack();
              }}
              className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]"
            >
              <ArrowLeft className="text-muted-foreground size-3.5 shrink-0" />
              Back to parent
            </button>
          )}
          {sorted.length > 0 && (
            <>
              <div className="text-muted-foreground px-2 pt-1.5 pb-1 font-mono text-[9px] tracking-[0.12em] uppercase">
                Subagents
              </div>
              {sorted.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onOpenSubagent(session);
                  }}
                  className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      sessionRunning(session) ? "animate-pulse bg-success" : "bg-border",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">
                      {session.title?.trim() || session.agent || "Subagent"}
                    </span>
                    <span className="text-muted-foreground block truncate text-[10px]">
                      {session.agent ?? "subagent"}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatRelative(session.time.updated)}
                  </span>
                </button>
              ))}
            </>
          )}
          {!inlineLinks && transport === "local" && directory && (
            <>
              <div className="bg-border my-1 h-px" />
              <a
                href={termHref(termURL, directory)}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="hover:bg-accent/60 flex items-center gap-2 rounded px-2 py-1.5 text-[12px]"
              >
                <Terminal className="text-muted-foreground size-3.5 shrink-0" />
                Terminal
              </a>
              <a
                href={peroHref(peroURL, directory)}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="hover:bg-accent/60 flex items-center gap-2 rounded px-2 py-1.5 text-[12px]"
              >
                <FileCode2 className="text-muted-foreground size-3.5 shrink-0" />
                Pero
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const Header = memo(function Header({
  session,
  directory: fallbackDirectory,
  contextPercent,
  cost,
  estimatedCost,
  termURL,
  peroURL,
  transport,
  collapsed,
  subagents,
  parent,
  onOpenSubagent,
  onBack,
  onToggleSidebar,
  onOpenChats,
  onNewChat,
  canNew,
}: {
  session: Session | null;
  directory?: string | null;
  contextPercent?: number | null;
  cost?: number;
  estimatedCost?: boolean;
  termURL: string;
  peroURL: string;
  transport: string;
  collapsed: boolean;
  subagents: Session[];
  parent?: Session | null;
  onOpenSubagent: (session: Session) => void;
  onBack: () => void;
  onToggleSidebar: () => void;
  onOpenChats: () => void;
  onNewChat: () => void;
  canNew: boolean;
}) {
  const directory = session?.location?.directory ?? fallbackDirectory;
  const inlineLinks = useMedia("(min-width: 340px)");
  return (
    <header className="from-background via-background/80 pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b to-transparent px-2.5 pt-2 pb-5">
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto hidden size-9 md:inline-flex"
          onClick={onToggleSidebar}
          title={collapsed ? "Show chats" : "Hide chats"}
          aria-label={collapsed ? "Show chats" : "Hide chats"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>

        <SessionPill
          session={session}
          directory={directory}
          contextPercent={contextPercent}
          cost={cost}
          estimatedCost={estimatedCost}
          className="pointer-events-auto max-w-2xl"
        />

        <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
          {transport === "local" && (
            <WorkspaceLinks directory={directory} termURL={termURL} peroURL={peroURL} />
          )}
          {parent && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={onBack}
              title="Back to parent"
            >
              <ArrowLeft />
              Parent
            </Button>
          )}
          {!parent && (
            <SubagentMenu
              sessions={subagents}
              onOpen={onOpenSubagent}
              className="hidden md:inline-flex"
            />
          )}
        </div>
      </div>

      <div className="pointer-events-auto flex min-w-0 flex-1 flex-col md:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9 shrink-0"
            onClick={onOpenChats}
            title="Chats"
            aria-label="Open chats"
          >
            <Layers />
          </Button>
          <SessionTitle session={session} className="min-w-0 flex-1 px-0.5" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9 shrink-0"
            onClick={onNewChat}
            disabled={!canNew}
            title="New chat"
            aria-label="New chat"
          >
            <Plus />
          </Button>
          {inlineLinks && transport === "local" && (
            <WorkspaceLinks
              directory={directory}
              termURL={termURL}
              peroURL={peroURL}
              className="shrink-0"
            />
          )}
          <MobileMenu
            directory={directory}
            termURL={termURL}
            peroURL={peroURL}
            transport={transport}
            subagents={subagents}
            parent={parent}
            inlineLinks={inlineLinks}
            onOpenSubagent={onOpenSubagent}
            onBack={onBack}
          />
        </div>
        <SessionMeta
          session={session}
          directory={directory}
          contextPercent={contextPercent}
          cost={cost}
          estimatedCost={estimatedCost}
          className="mt-0.5 pl-10"
        />
      </div>
    </header>
  );
});
