import { useState } from "react";
import { ArrowLeft, ChevronDown, GitBranch, Loader2 } from "lucide-react";
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

export function SubagentBar({
  sessions,
  parent,
  onOpen,
  onBack,
}: {
  sessions: Session[];
  parent?: Session | null;
  onOpen: (session: Session) => void;
  onBack?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = sessions.filter((session) => sessionRunning(session)).length;
  const sorted = [...sessions].sort((a, b) => {
    const running = Number(sessionRunning(b)) - Number(sessionRunning(a));
    return running || b.time.updated - a.time.updated;
  });

  if (parent) {
    return (
      <div className="border-border bg-card/40 flex items-center gap-2 border-b px-4 py-1.5 text-[11px]">
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft />
          Back to parent
        </Button>
        <span className="text-muted-foreground truncate">
          Subagent · {label(parent)}
        </span>
      </div>
    );
  }

  if (sessions.length === 0) return null;

  return (
    <div className="border-border bg-card/40 relative flex items-center gap-2 border-b px-4 py-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-accent/60 flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5"
        aria-expanded={open}
      >
        <GitBranch className="text-muted-foreground size-3.5" />
        <span className="font-medium">{sessions.length} subagents</span>
        {active > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <Loader2 className="size-3 animate-spin" />
            {active} working
          </span>
        )}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-border bg-popover absolute top-full left-3 z-30 mt-1 w-80 rounded-lg border p-1 shadow-lg">
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
