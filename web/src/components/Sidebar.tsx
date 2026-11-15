import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CornerDownRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Inbox,
  Layers,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import type { Health, Session } from "../lib/types";
import type { StreamStatus } from "../hooks/useEventStream";
import { themeLabel, type Theme } from "../lib/themes";
import { basename, filterSessions, formatRelative } from "../lib/format";
import { BASE_PATH } from "../lib/base";
import {
  SCOPES,
  groupByDirectory,
  groupKey,
  groupSessions,
  hoistFinished,
  type Scope,
  type SessionRow,
} from "../lib/sessions";
import { cn } from "../lib/utils";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { ConnectionStatus } from "./ConnectionStatus";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") return <Sun />;
  if (theme === "dark") return <Moon />;
  if (theme === "system") return <Monitor />;
  return <Palette />;
}

function SessionRow({
  session,
  depth,
  active,
  running,
  waiting,
  failed,
  done,
  hidden,
  now,
  subagentCount = 0,
  runningSubagents = 0,
  expanded = false,
  showDirectory = true,
  onClick,
  onToggle,
  onHide,
  onUnhide,
  onDelete,
}: {
  session: Session;
  depth: number;
  active: boolean;
  running: boolean;
  waiting: boolean;
  failed: boolean;
  done: boolean;
  hidden: boolean;
  now: number;
  subagentCount?: number;
  runningSubagents?: number;
  expanded?: boolean;
  showDirectory?: boolean;
  onClick: () => void;
  onToggle?: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onDelete: () => void;
}) {
  const title = session.title?.trim() || (session.parentID ? "Subagent" : "New chat");
  const doneHere = done && runningSubagents === 0;
  const state = waiting
    ? "session-waiting"
    : failed
      ? "session-failed"
      : doneHere
        ? "session-done"
        : null;
  const hasSubagents = depth === 0 && subagentCount > 0;
  return (
    <div
      data-session-row={session.id}
      className={cn(
        "group relative mx-1.5 rounded-lg transition-colors",
        hidden && "opacity-60",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        data-session-id={session.id}
        onClick={onClick}
        onDoubleClick={hasSubagents ? onToggle : undefined}
        aria-label={session.agent ? `${title} · ${session.agent}` : title}
        title={session.agent ? `${title} · ${session.agent}` : title}
        style={{ position: "absolute" }}
        className={cn("absolute inset-0 rounded-lg", state && cn("session-state", state))}
      />
      <div
        className={cn(
          "pointer-events-none relative flex flex-col gap-1 px-2.5 py-2",
          depth > 0 && "pl-9",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {depth > 0 ? (
            <CornerDownRight
              className={cn(
                "size-3 shrink-0",
                waiting ? "text-spark" : "text-muted-foreground",
              )}
            />
          ) : (
            <span className="flex size-4 shrink-0 items-center justify-center">
              {hasSubagents && (
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={expanded}
                  aria-label={expanded ? "Hide subagents" : "Show subagents"}
                  title={expanded ? "Hide subagents" : "Show subagents"}
                  className="pointer-events-auto flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
              )}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
          <span
            className={cn(
              "shrink-0 text-[10px] transition-opacity group-hover:opacity-0",
              waiting
                ? "text-foreground font-semibold"
                : running
                  ? "text-success"
                  : "text-muted-foreground",
            )}
            title={
              waiting
                ? "Waiting for your answer"
                : running
                  ? "Running"
                  : doneHere
                    ? "Done"
                    : undefined
            }
          >
            {waiting
              ? "Waiting for your answer"
              : running
                ? "running"
                : formatRelative(session.time.updated, now)}
          </span>
        </div>
        {depth === 0 && showDirectory && (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1 pl-10 text-[10px]">
            <Folder className="size-3 shrink-0" />
            <span className="truncate" title={session.location?.directory}>
              {basename(session.location?.directory) || "unknown"}
            </span>
            {session.instance && (
              <span className="shrink-0 font-mono opacity-70" title={session.instance}>
                {session.instance}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="absolute top-1 right-1 hidden items-center gap-0.5 group-hover:flex">
        {hidden ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-success hover:bg-success/10"
            onClick={onUnhide}
            title="Unhide chat"
            aria-label="Unhide chat"
          >
            <Eye />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:bg-destructive/10"
            onClick={onHide}
            title="Hide chat"
            aria-label="Hide chat"
          >
            <EyeOff />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          title="Delete chat"
          aria-label="Delete chat"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

export const Sidebar = memo(function Sidebar({
  sessions,
  subagents,
  workspace,
  scope,
  poolChats,
  poolDirectories,
  selectedId,
  loading,
  health,
  streamStatus,
  theme,
  search,
  searchRef,
  hiddenIds,
  hiddenCount,
  showHidden,
  onSearch,
  onScope,
  onWorkspace,
  onSelect,
  onNew,
  onHide,
  onUnhide,
  onDelete,
  onToggleHidden,
  onSettings,
  onTheme,
  instance,
  onInstances,
  isRunning,
  waitingIds,
  failedIds,
  doneIds,
  motion,
  reviewCount,
  onReview,
}: {
  sessions: Session[];
  subagents: Session[];
  workspace: string | null;
  scope: Scope;
  poolChats: number;
  poolDirectories: number;
  selectedId: string | null;
  loading: boolean;
  health: Health | null;
  streamStatus: StreamStatus;
  theme: Theme;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  hiddenIds: Set<string>;
  hiddenCount: number;
  showHidden: boolean;
  onSearch: (value: string) => void;
  onScope: (scope: Scope) => void;
  onWorkspace: () => void;
  onSelect: (id: string) => void;
  onNew: (directory?: string) => void;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleHidden: () => void;
  onSettings: () => void;
  onTheme: () => void;
  instance: string;
  onInstances: () => void;
  isRunning: (id: string) => boolean;
  waitingIds: Set<string>;
  failedIds: Set<string>;
  doneIds: Set<string>;
  motion: "animated" | "static";
  reviewCount: number;
  onReview: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [fading, setFading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const autoExpanded = useRef<string | null>(null);
  const modKey =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selectedId || autoExpanded.current === selectedId) return;
    const parentID = subagents.find((session) => session.id === selectedId)?.parentID;
    if (parentID) {
      autoExpanded.current = selectedId;
      setExpanded((previous) =>
        previous.has(parentID) ? previous : new Set(previous).add(parentID),
      );
    }
  }, [selectedId, subagents]);

  const runningParents = new Set<string>();
  for (const child of subagents) {
    if (child.parentID && isRunning(child.id)) runningParents.add(child.parentID);
  }

  const working = (id: string) => isRunning(id) || runningParents.has(id);

  const rank = (session: Session) => {
    if (waitingIds.has(session.id) || failedIds.has(session.id)) return 0;
    if (working(session.id)) return 2;
    if (doneIds.has(session.id)) return 0;
    return 1;
  };

  const visible = groupSessions(filterSessions(sessions, search), waitingIds, rank);
  const waitingCount = sessions.filter((session) => waitingIds.has(session.id)).length;
  const childrenByParent = new Map<string, Session[]>();
  for (const session of subagents) {
    if (!session.parentID) continue;
    const list = childrenByParent.get(session.parentID) ?? [];
    list.push(session);
    childrenByParent.set(session.parentID, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => rank(a) - rank(b) || b.time.updated - a.time.updated);
  }
  const animated = motion === "animated";
  const orderSignature = visible
    .map(({ session }) => {
      const kids = expanded.has(session.id)
        ? (childrenByParent.get(session.id) ?? [])
            .map((child) => child.id)
            .join(",")
        : "";
      return `${session.id}:${rank(session)}[${kids}]`;
    })
    .join("|");
  const listRef = useRef<HTMLDivElement | null>(null);
  const positions = useRef(new Map<string, number>());
  const lastOrder = useRef("");
  const lastScope = useRef(scope);
  const selectedSession = selectedId
    ? ([...sessions, ...subagents].find((session) => session.id === selectedId) ?? null)
    : null;
  const selectedRank = selectedSession ? rank(selectedSession) : null;
  const pool = scope !== "directory";
  const scopeIndex = Math.max(
    0,
    SCOPES.findIndex((item) => item.id === scope),
  );
  const poolLabel = SCOPES.find((item) => item.id === scope)?.label ?? "All chats";
  const { top: finishedRows, rest } = hoistFinished(visible, (session) => rank(session) === 0);
  const firstRunning = rest.findIndex(
    (row) => row.depth === 0 && rank(row.session) === 2,
  );
  const runningStart = firstRunning === -1 ? rest.length : firstRunning;
  const runningGroupCount = rest
    .slice(runningStart)
    .filter((row) => row.depth === 0).length;
  const poolGroups = pool ? groupByDirectory(rest.slice(0, runningStart)) : [];

  const renderRow = ({ session, depth }: SessionRow, grouped = false) => {
    const children = childrenByParent.get(session.id) ?? [];
    const runningChildren = children.filter((child) => isRunning(child.id)).length;
    const open = expanded.has(session.id);
    return (
      <Fragment key={session.id}>
        <SessionRow
          session={session}
          depth={depth}
          active={session.id === selectedId}
          running={working(session.id)}
          waiting={waitingIds.has(session.id)}
          failed={failedIds.has(session.id)}
          done={doneIds.has(session.id)}
          hidden={hiddenIds.has(session.id)}
          now={now}
          showDirectory={scope !== "directory" && !grouped}
          subagentCount={children.length}
          runningSubagents={runningChildren}
          expanded={open}
          onClick={() => onSelect(session.id)}
          onToggle={() =>
            setExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(session.id)) next.delete(session.id);
              else next.add(session.id);
              return next;
            })
          }
          onHide={() => onHide(session.id)}
          onUnhide={() => onUnhide(session.id)}
          onDelete={() => onDelete(session.id)}
        />
        {open && (
          <div className="space-y-0.5">
            {children.map((child) => (
              <SessionRow
                key={child.id}
                session={child}
                depth={depth + 1}
                active={child.id === selectedId}
                running={working(child.id)}
                waiting={waitingIds.has(child.id)}
                failed={failedIds.has(child.id)}
                done={doneIds.has(child.id)}
                hidden={hiddenIds.has(child.id)}
                now={now}
                onClick={() => onSelect(child.id)}
                onHide={() => onHide(child.id)}
                onUnhide={() => onUnhide(child.id)}
                onDelete={() => onDelete(child.id)}
              />
            ))}
          </div>
        )}
      </Fragment>
    );
  };

  useLayoutEffect(() => {
    const switched = lastScope.current !== scope;
    lastScope.current = scope;
    if (!switched && scope !== "directory") return;
    positions.current = new Map();
    lastOrder.current = "";
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [scope, workspace]);

  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container || orderSignature === lastOrder.current) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-session-row]"));
    const box = container.getBoundingClientRect();
    const next = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.sessionRow;
      if (id) {
        next.set(id, row.getBoundingClientRect().top - box.top + container.scrollTop);
      }
    }
    if (lastOrder.current && animated) {
      for (const row of rows) {
        const id = row.dataset.sessionRow;
        if (!id) continue;
        const before = positions.current.get(id);
        const after = next.get(id);
        if (before === undefined || after === undefined) continue;
        const delta = before - after;
        if (Math.abs(delta) < 1 || typeof row.animate !== "function") continue;
        row.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
          { duration: 320, easing: "cubic-bezier(0.22, 0.7, 0.2, 1)" },
        );
      }
    }
    positions.current = next;
    lastOrder.current = orderSignature;
  }, [animated, orderSignature]);

  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const update = () => setFading(container.scrollHeight > container.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!selectedId || selectedRank === null) return;
    const container = listRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-session-row="${selectedId}"]`);
    if (!container || !row) return;
    const box = container.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top >= box.top && target.bottom <= box.bottom) return;
    row.scrollIntoView({ block: "nearest", behavior: animated ? "smooth" : "auto" });
  }, [animated, expanded, selectedId, selectedRank]);

  return (
    <div className="bg-card/40 flex h-full min-h-0 flex-col">
      <span className="sr-only" aria-live="polite">
        {waitingCount > 0
          ? `${waitingCount} chat${waitingCount === 1 ? "" : "s"} waiting for your answer`
          : ""}
      </span>
      <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
        <button
          type="button"
          onClick={onWorkspace}
          className="hover:bg-accent/40 -mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left"
          title={workspace ?? "Choose a workspace"}
        >
          <span className="relative size-7 shrink-0">
            <span
              className={cn(
                "bg-foreground text-background absolute inset-0 flex items-center justify-center rounded-md font-mono text-xs font-bold",
                animated && "transition-all duration-300 ease-out",
                pool && "scale-75 opacity-0",
              )}
            >
              n
            </span>
            <span
              className={cn(
                "bg-muted text-muted-foreground absolute inset-0 flex items-center justify-center rounded-md",
                animated && "transition-all duration-300 ease-out",
                !pool && "scale-75 opacity-0",
              )}
            >
              <Layers className="size-3.5" />
            </span>
          </span>
          <span className="relative grid min-w-0 flex-1">
            <span
              className={cn(
                "col-start-1 row-start-1 min-w-0",
                animated && "transition-all duration-300 ease-out",
                pool && "pointer-events-none translate-y-1 opacity-0",
              )}
            >
              <span className="block truncate text-[13px] leading-tight font-semibold">
                {workspace ? basename(workspace) : "No workspace"}
              </span>
              <span className="text-muted-foreground flex items-center gap-1 text-[10px] leading-tight">
                <FolderOpen className="size-3 shrink-0" />
                <span className="truncate">{workspace ?? "Choose a directory"}</span>
              </span>
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 min-w-0",
                animated && "transition-all duration-300 ease-out",
                !pool && "pointer-events-none -translate-y-1 opacity-0",
              )}
            >
              <span className="block truncate text-[13px] leading-tight font-semibold">
                {poolLabel}
              </span>
              <span className="text-muted-foreground block truncate text-[10px] leading-tight">
                {poolDirectories} {poolDirectories === 1 ? "directory" : "directories"} ·{" "}
                {poolChats} chats
              </span>
            </span>
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-3.5 shrink-0",
              animated && "transition-transform duration-300",
              pool && "rotate-180",
            )}
          />
        </button>
      </div>

      <div className="px-3 pb-2" role="group" aria-label="Chat scope">
        <div
          className="relative grid text-[11px] font-medium"
          style={{ gridTemplateColumns: `repeat(${SCOPES.length}, minmax(0, 1fr))` }}
        >
          <span
            aria-hidden
            className={cn(
              "bg-accent/70 absolute inset-y-0 left-0 rounded-md",
              animated && "transition-transform duration-300 ease-out",
            )}
            style={{
              width: `${100 / SCOPES.length}%`,
              transform: `translateX(${scopeIndex * 100}%)`,
            }}
          />
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={scope === item.id}
              onClick={() => onScope(item.id)}
              className={cn(
                "relative z-10 min-w-0 truncate rounded-md px-2 py-1 transition-colors",
                scope === item.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={
                item.id === "directory"
                  ? (workspace ?? "Chats in this directory")
                  : item.id === "mine"
                    ? "Every chat, every directory"
                    : "Chats from every instance"
              }
            >
              {item.id === "directory" && workspace ? (
                <span
                  key={workspace}
                  className={cn("block truncate", animated && "sidebar-sheen-scope-in")}
                >
                  {basename(workspace)}
                </span>
              ) : (
                item.label
              )}
            </button>
          ))}
        </div>
      </div>

      {!pool && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onReview}
            className="hover:bg-accent/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
            title="Review: pending vision and acceptance"
          >
            <ClipboardCheck className="text-muted-foreground size-3.5" />
            <span className="text-xs font-medium">Review</span>
            {reviewCount > 0 && (
              <span className="bg-spark text-background ml-auto rounded-full px-1.5 text-[10px] leading-5 tabular-nums">
                {reviewCount}
              </span>
            )}
          </button>
        </div>
      )}

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-8 bg-background pr-14 pl-8 text-xs"
          />
          {search.trim() && (
            <span
              className={cn(
                "sidebar-sheen-search-count text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-[9px] tabular-nums",
                animated && "sidebar-sheen-search-count-in",
              )}
              title={`${visible.length} matching chats`}
            >
              {visible.length}
            </span>
          )}
          <kbd
            className={cn(
              "border-border text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 font-mono text-[9px] transition-opacity",
              search.trim() && "opacity-0",
            )}
          >
            {modKey}
          </kbd>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => onNew()}
          disabled={!health?.ok || !workspace}
        >
          <Plus />
          New chat
          {pool && workspace && (
            <span className="text-muted-foreground ml-1 truncate text-[10px] font-normal">
              in {basename(workspace)}
            </span>
          )}
          <kbd className="border-border text-muted-foreground ml-auto rounded border px-1 font-mono text-[9px] font-normal">
            Alt N
          </kbd>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          className={cn(
            "scrollbar-thin relative min-h-0 touch-pan-y overflow-y-auto px-2 pb-2",
            fading &&
              "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_4rem),transparent)]",
          )}
        >
          {loading && sessions.length === 0 ? (
            <div className="space-y-2 px-1 py-2">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="space-y-1.5 rounded-lg px-2 py-2">
                  <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
                  <div className="bg-muted h-2 w-1/2 animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-3 py-10 text-center text-xs">
              <MessageSquare className="size-5 opacity-60" />
              {search
                ? "No chats match."
                : scope === "directory"
                  ? "No chats in this workspace yet."
                  : scope === "everywhere"
                    ? "No chats on any machine yet."
                    : "No chats yet."}
            </div>
          ) : (
            <>
              {finishedRows.length > 0 && (
                <div
                  className="scrollbar-thin sticky top-0 z-10 -mx-2 mb-1 max-h-[45vh] overflow-y-auto px-2 pb-1"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--card) 40%, var(--background))",
                  }}
                >
                  <div className="space-y-0.5">
                    {finishedRows.map((row) => renderRow(row))}
                  </div>
                </div>
              )}
              {pool ? (
                <div className="relative space-y-0.5">
                  {poolGroups.map((group) => (
                    <Fragment key={groupKey(group)}>
                      <div className="text-muted-foreground flex items-center gap-2 px-3 pt-2.5 pb-0.5 text-[10px] font-medium">
                        {scope === "everywhere" ? (
                          <span className="min-w-0 truncate" title={group.directory}>
                            {basename(group.directory) || group.directory || "unknown"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onNew(group.directory)}
                            title={`New chat in ${group.directory}`}
                            aria-label={`New chat in ${group.directory}`}
                            className="hover:text-foreground min-w-0 rounded-md text-left hover:underline"
                          >
                            <span className="block truncate">
                              {basename(group.directory) || group.directory || "unknown"}
                            </span>
                          </button>
                        )}
                        {group.instance && (
                          <span
                            className="border-border shrink-0 rounded border px-1 font-mono text-[9px]"
                            title={`Calls from ${group.instance}`}
                          >
                            {group.instance}
                          </span>
                        )}
                        <span className="tabular-nums opacity-60">{group.rows.length}</span>
                        <span className="bg-border h-px flex-1 opacity-50" />
                      </div>
                      {group.rows.map((row) => renderRow(row, true))}
                    </Fragment>
                  ))}
                </div>
              ) : (
                <div className="relative space-y-0.5">
                  {rest.slice(0, runningStart).map((row) => renderRow(row))}
                </div>
              )}
            </>
          )}
        </div>
        {runningStart < rest.length && (
          <div className="max-h-[70%] shrink-0 overflow-y-auto px-2">
            <div className="text-muted-foreground flex items-center gap-2 px-2 pt-3 pb-1 font-mono text-[9px] tracking-[0.12em] uppercase">
              <span className="bg-success size-1.5 rounded-full" />
              <span>Running</span>
              <span className="text-muted-foreground/70 tabular-nums">
                {runningGroupCount}
              </span>
              <span className="bg-border h-px flex-1 opacity-60" />
            </div>
            {rest.slice(runningStart).map((row) => renderRow(row))}
          </div>
        )}
        <div className="flex-1" />
      </div>

      <div className="border-border text-muted-foreground flex items-center gap-0.5 border-t px-1.5 py-1.5 text-[10px]">
        <ConnectionStatus
          health={health}
          streamStatus={streamStatus}
          instance={instance}
          onOpen={onInstances}
        />
        <a
          href={`${BASE_PATH}/drop/`}
          target="_blank"
          rel="noreferrer"
          title="Drop"
          aria-label="Drop"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "text-muted-foreground",
          )}
        >
          <Inbox />
        </a>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onTheme}
          title={`Theme: ${themeLabel(theme)}`}
          aria-label={`Theme: ${themeLabel(theme)}`}
        >
          <ThemeIcon theme={theme} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
        >
          <Settings />
        </Button>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onToggleHidden}
            className="hover:text-foreground ml-auto inline-flex items-center gap-1"
            title={showHidden ? "Hide hidden chats" : "Show hidden chats"}
          >
            {showHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {hiddenCount}
          </button>
        )}
        <span
          className={cn("pr-1 font-mono", hiddenCount === 0 && "ml-auto")}
          title={`${sessions.length} chats`}
        >
          {sessions.length}
        </span>
      </div>
    </div>
  );
});
