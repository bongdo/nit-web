import { useState } from "react";
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
  className,
}: {
  sessions: Session[];
  onOpen: (session: Session) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = sessions.filter((session) => sessionRunning(session)).length;
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => {
    const running = Number(sessionRunning(b)) - Number(sessionRunning(a));
    return running || b.time.updated - a.time.updated;
  });

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-9", className)}
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranch />
        <span>{sessions.length}</span>
        {active > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <Loader2 className="size-3 animate-spin" />
            {active}
          </span>
        )}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="border-border bg-popover absolute top-full right-0 z-40 mt-1 w-80 rounded-lg border p-1 shadow-lg">
          {sorted.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen(session);
              }}
              className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  sessionRunning(session) ? "animate-pulse bg-emerald-500" : "bg-border",
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
                  sessionRunning(session) ? "text-emerald-500" : "text-muted-foreground",
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
