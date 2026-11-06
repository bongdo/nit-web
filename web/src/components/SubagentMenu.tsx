import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch, Loader2 } from "lucide-react";
import type { Session } from "../lib/types";
import { formatRelative, sessionRunning } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

function label(session: Session): string {
  return session.title?.trim() || session.agent || "Subagent";
}

function duration(session: Session): string {
  if (sessionRunning(session)) return "working";
  const end = session.time.idle ?? session.time.updated;
  const start = session.time.busy ?? session.time.created;
  if (!start || !end || end <= start) return "";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function SubagentMenu({
  sessions,
  onOpen,
  placement = "down",
  className,
}: {
  sessions: Session[];
  onOpen: (session: Session) => void;
  placement?: "down" | "up";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = sessions.filter((session) => sessionRunning(session)).length;

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

  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => {
    const running = Number(sessionRunning(b)) - Number(sessionRunning(a));
    return running || b.time.updated - a.time.updated;
  });

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-9", className)}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Subagents (${sessions.length})`}
        title={`Subagents (${sessions.length})`}
      >
        <GitBranch />
        <span>{sessions.length}</span>
        {active > 0 && (
          <span className="inline-flex items-center gap-1 text-success">
            <Loader2 className="size-3 animate-spin" />
            {active}
          </span>
        )}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            "border-border bg-popover absolute z-40 w-80 max-w-[calc(100vw-1rem)] rounded-lg border p-1 shadow-lg",
            placement === "up"
              ? "bottom-full left-1/2 mb-1 max-h-[55dvh] -translate-x-1/2 overflow-y-auto"
              : "top-full right-0 mt-1",
          )}
        >
          {sorted.map((session) => (
            <button
              key={session.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpen(session);
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
                <span className="block truncate text-[12px]">{label(session)}</span>
                <span className="text-muted-foreground block truncate text-[10px]">
                  {session.agent ?? "subagent"} · {duration(session)}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  sessionRunning(session) ? "text-success" : "text-muted-foreground",
                )}
              >
                {sessionRunning(session) ? "running" : formatRelative(session.time.updated)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
