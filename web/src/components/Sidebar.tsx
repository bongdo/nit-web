import { useEffect, useState, type RefObject } from "react";
import { Folder, Loader2, MessageSquare, Plus, Search } from "lucide-react";
import type { Health, Session } from "../lib/types";
import { basename, filterSessions, formatRelative } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function SessionRow({
  session,
  active,
  running,
  now,
  onClick,
}: {
  session: Session;
  active: boolean;
  running: boolean;
  now: number;
  onClick: () => void;
}) {
  const title = session.title?.trim() || "New session";
  return (
    <button
      type="button"
      data-session-id={session.id}
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            running ? "animate-pulse bg-emerald-500" : "bg-border",
          )}
          aria-label={running ? "running" : "idle"}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {formatRelative(session.time.updated, now)}
        </span>
      </div>
      <div className="text-muted-foreground flex min-w-0 items-center gap-1 pl-3.5 text-[10px]">
        <Folder className="size-3 shrink-0" />
        <span className="truncate" title={session.location?.directory}>
          {basename(session.location?.directory) || "unknown"}
        </span>
      </div>
    </button>
  );
}

export function Sidebar({
  sessions,
  selectedId,
  loading,
  creating,
  health,
  search,
  searchRef,
  onSearch,
  onSelect,
  onNew,
  isRunning,
}: {
  sessions: Session[];
  selectedId: string | null;
  loading: boolean;
  creating: boolean;
  health: Health | null;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  isRunning: (id: string) => boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const modKey =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = filterSessions(sessions, search);
  const runningCount = sessions.filter((session) => isRunning(session.id)).length;

  return (
    <div className="bg-card/40 flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="bg-foreground text-background flex size-7 items-center justify-center rounded-md font-mono text-xs font-bold">
          n
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">nit-gui</div>
          <div className="text-muted-foreground text-[10px] leading-tight">OpenCode chat</div>
        </div>
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
            placeholder="Search sessions"
            aria-label="Search sessions"
            className="h-8 bg-background pr-14 pl-8 text-xs"
          />
          <kbd className="border-border text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 font-mono text-[9px]">
            {modKey}
          </kbd>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onNew}
          disabled={creating || !health?.ok}
        >
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          New session
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
            {search ? "No sessions match." : "No sessions yet."}
          </div>
        ) : (
          <div className="space-y-0.5">
            {visible.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === selectedId}
                running={isRunning(session.id)}
                now={now}
                onClick={() => onSelect(session.id)}
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
        <span className="ml-auto font-mono">{sessions.length}</span>
      </div>
    </div>
  );
}
