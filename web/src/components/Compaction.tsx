import { useEffect, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { formatTokens } from "../lib/format";
import { cn } from "../lib/utils";
import type { Message } from "../lib/types";
import { Markdown } from "./Markdown";

function reasonLabel(reason?: string): string {
  if (reason === "manual") return "on request";
  if (reason === "auto") return "automatically";
  return reason ?? "";
}

function Tile() {
  return (
    <span className="compaction-tile bg-spark/10 text-spark grid size-5 shrink-0 place-items-center rounded-full">
      <Layers className="size-3.5" />
    </span>
  );
}

export function CompactionBusy() {
  return (
    <div className="my-5 flex justify-center" role="status" aria-live="polite">
      <div className="compaction-busy compaction-pill bg-card/80 relative flex items-center gap-2 overflow-hidden rounded-full border border-spark/30 py-1.5 pr-3 pl-2 text-xs">
        <Tile />
        <span>Compacting context</span>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="compaction-dot bg-muted-foreground size-[3px] rounded-full"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export function CompactionRow({
  message,
  autoOpen,
}: {
  message: Message;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = `compaction-${message.id}`;
  const summary = message.summary?.trim() ?? "";
  const reason = reasonLabel(message.reason);
  const tokens = message.tokens?.input ?? 0;
  const busy = message.status === "running" || message.status === "pending";

  useEffect(() => {
    if (!autoOpen || !summary) return;
    const timer = window.setTimeout(() => setOpen(true), 320);
    return () => window.clearTimeout(timer);
  }, [autoOpen, summary]);

  if (busy) return <CompactionBusy />;

  const label = (
    <>
      <Tile />
      <span className="font-medium">Context compacted</span>
      {tokens > 0 && (
        <>
          <span className="bg-muted-foreground/50 hidden size-[3px] shrink-0 rounded-full sm:block" />
          <span className="text-muted-foreground hidden text-[11px] tabular-nums sm:inline">
            {formatTokens(tokens)} tokens
          </span>
        </>
      )}
      {summary && (
        <ChevronDown
          className={cn(
            "text-muted-foreground size-3 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      )}
    </>
  );

  return (
    <div className={cn("my-5", autoOpen && "compaction-enter")}>
      <div className="flex items-center gap-3">
        <span className="compaction-line via-border to-border/60 h-px flex-1 bg-gradient-to-r from-transparent" />
        {summary ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((current) => !current)}
            className="compaction-pill bg-card/80 hover:border-spark/45 hover:bg-accent/40 relative flex max-w-full items-center gap-2 overflow-hidden rounded-full border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors"
          >
            {label}
          </button>
        ) : (
          <span className="compaction-pill bg-card/80 relative flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs whitespace-nowrap">
            {label}
          </span>
        )}
        <span className="compaction-line via-border to-border/60 h-px flex-1 bg-gradient-to-l from-transparent" />
      </div>

      {summary && (
        <div
          id={id}
          inert={!open}
          className={cn(
            "grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
            open && "grid-rows-[1fr]",
          )}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "mx-auto max-w-[620px] pt-3 transition-opacity duration-200 motion-reduce:transition-none",
                open ? "opacity-100" : "opacity-0",
              )}
            >
              <div className="text-muted-foreground mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.09em] uppercase">
                <span>Summary of earlier conversation</span>
                <span className="bg-border h-px flex-1 opacity-70" />
                {reason && (
                  <span className="max-w-[40%] truncate normal-case tracking-normal">{reason}</span>
                )}
              </div>
              <div className="scrollbar-thin max-h-[min(50vh,20rem)] overflow-y-auto pr-1">
                <Markdown
                  text={summary}
                  className="compaction-summary text-muted-foreground"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
