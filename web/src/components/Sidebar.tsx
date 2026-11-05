import { useEffect, useState, type RefObject } from "react";
import {
  CornerDownRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { Health, Session } from "../lib/types";
import { basename, filterSessions, formatRelative } from "../lib/format";
import { SCOPES, groupSessions, type Scope } from "../lib/sessions";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function SessionRow({
  session,
  depth,
  active,
  running,
  hidden,
  now,
  onClick,
  onHide,
  onUnhide,
  onDelete,
}: {
  session: Session;
  depth: number;
  active: boolean;
  running: boolean;
  hidden: boolean;
  now: number;
  onClick: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onDelete: () => void;
}) {
  const title = session.title?.trim() || (session.parentID ? "Subagent" : "New chat");
  return (
    <div
      className="group relative"
      style={{
        marginLeft: depth * 12,
        width: depth > 0 ? `calc(100% - ${depth * 12}px)` : undefined,
      }}
    >
      <button
        type="button"
        data-session-id={session.id}
        onClick={onClick}
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
          depth > 0 && "py-1.5",
          hidden && "opacity-60",
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {depth > 0 ? (
            <CornerDownRight className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                running ? "animate-pulse bg-emerald-500" : "bg-border",
              )}
              aria-label={running ? "running" : "idle"}
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
          <span
            className={cn(
              "shrink-0 text-[10px] transition-opacity group-hover:opacity-0",
              running ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {running ? "running" : formatRelative(session.time.updated, now)}
          </span>
        </div>
        {depth === 0 && (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1 pl-3.5 text-[10px]">
            <Folder className="size-3 shrink-0" />
            <span className="truncate" title={session.location?.directory}>
              {basename(session.location?.directory) || "unknown"}
            </span>
          </div>
        )}
      </button>
      <div className="absolute top-1 right-1 hidden items-center gap-0.5 group-hover:flex">
        {hidden ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-emerald-500 hover:bg-emerald-500/10"
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

export function Sidebar({
  sessions,
  workspace,
  scope,
  selectedId,
  loading,
  health,
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
  isRunning,
}: {
  sessions: Session[];
  workspace: string | null;
  scope: Scope;
  selectedId: string | null;
  loading: boolean;
  health: Health | null;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  hiddenIds: Set<string>;
  hiddenCount: number;
  showHidden: boolean;
  onSearch: (value: string) => void;
  onScope: (scope: Scope) => void;
  onWorkspace: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleHidden: () => void;
  isRunning: (id: string) => boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const modKey =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = groupSessions(filterSessions(sessions, search));
  const runningCount = sessions.filter((session) => isRunning(session.id)).length;

  return (
    <div className="bg-card/40 flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="bg-foreground text-background flex size-7 items-center justify-center rounded-md font-mono text-xs font-bold">
          n
        </div>
        <button
          type="button"
          onClick={onWorkspace}
          className="hover:bg-accent/60 -mx-1 min-w-0 flex-1 rounded-md px-1 py-0.5 text-left"
          title={workspace ?? "Choose a workspace"}
        >
          <div className="truncate text-[13px] font-semibold leading-tight">
            {workspace ? basename(workspace) : "No workspace"}
          </div>
          <div className="text-muted-foreground flex items-center gap-1 truncate text-[10px] leading-tight">
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{workspace ?? "Choose a directory"}</span>
          </div>
        </button>
        {runningCount > 0 && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {runningCount}
          </span>
        )}
      </div>

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
          <kbd className="border-border text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 font-mono text-[9px]">
            {modKey}
          </kbd>
        </div>
      </div>

      <div className="bg-muted/50 mx-3 mb-2 flex rounded-md p-0.5" role="group" aria-label="Chat scope">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={scope === item.id}
            onClick={() => onScope(item.id)}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
              scope === item.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              item.id === "directory"
                ? "Chats in this workspace"
                : item.id === "mine"
                  ? "All your chats, every workspace"
                  : "Everything, including subagents and scripted sessions"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onNew}
          disabled={!health?.ok || !workspace}
        >
          <Plus />
          New chat
          <kbd className="border-border text-muted-foreground ml-auto rounded border px-1 font-mono text-[9px] font-normal">
            Alt N
          </kbd>
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
                : "No chats yet."}
          </div>
        ) : (
          <div className="space-y-0.5">
            {visible.map(({ session, depth }) => (
              <SessionRow
                key={session.id}
                session={session}
                depth={depth}
                active={session.id === selectedId}
                running={isRunning(session.id)}
                hidden={hiddenIds.has(session.id)}
                now={now}
                onClick={() => onSelect(session.id)}
                onHide={() => onHide(session.id)}
                onUnhide={() => onUnhide(session.id)}
                onDelete={() => onDelete(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-border text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-[10px]">
        <span
          className={cn(
            "size-1.5 rounded-full",
            health?.ok ? "bg-emerald-500" : health ? "bg-destructive" : "bg-muted-foreground",
          )}
        />
        <span className="truncate">
          {health?.ok
            ? `OpenCode ${health.version ?? ""}`.trim()
            : health
              ? "Service offline"
              : "Connecting…"}
        </span>
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
        <span className={cn("font-mono", hiddenCount === 0 && "ml-auto")}>
          {sessions.length}
        </span>
      </div>
    </div>
  );
}
