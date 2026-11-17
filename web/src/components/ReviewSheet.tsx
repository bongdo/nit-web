import { useEffect, useMemo, useState } from "react";
import { Check, Clock, FileText } from "lucide-react";
import type { ReviewItem } from "../lib/types";
import { ageLabel, openItems, stripFrontmatter, type SnoozeMap } from "../lib/review";
import { cn } from "../lib/utils";
import { MarkdownLazy } from "./MarkdownLazy";
import { Button } from "./ui/button";
import { Modal } from "./ui/Modal";

export type ReviewAction = "accept" | "reject" | "later";

export function ReviewSheet({
  items,
  snooze,
  now,
  busyId,
  sentId,
  note,
  base,
  baseLoading,
  onClose,
  onAction,
  onOpenNote,
  onLoadBase,
}: {
  items: ReviewItem[];
  snooze: SnoozeMap;
  now: number;
  busyId: string | null;
  sentId: string | null;
  note: { path: string; text: string } | null;
  base: { path: string; text: string } | null;
  baseLoading: boolean;
  onClose: () => void;
  onAction: (item: ReviewItem, action: ReviewAction, text?: string) => void;
  onOpenNote: (item: ReviewItem) => void;
  onLoadBase: () => void;
}) {
  const [tab, setTab] = useState<"queue" | "base">("queue");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectText, setRejectText] = useState("");
  const open = useMemo(() => openItems(items), [items]);
  useEffect(() => {
    if (tab === "base" && !base && !baseLoading) onLoadBase();
  }, [tab, base, baseLoading, onLoadBase]);

  const startReject = (item: ReviewItem) => {
    setRejectId(item.id);
    setRejectText("");
  };

  const sendReject = (item: ReviewItem) => {
    const text = rejectText.trim();
    if (!text) return;
    onAction(item, "reject", text);
    setRejectId(null);
    setRejectText("");
  };

  return (
    <Modal
      label="Review"
      closeLabel="Close review"
      closeSize="icon-xs"
      title={
        <>
          <span className="text-sm font-semibold">Review</span>
          <span className="bg-secondary text-secondary-foreground rounded-full px-1.5 text-[10px] leading-5 tabular-nums">
            {open.length}
          </span>
        </>
      }
      onClose={onClose}
      className="items-end p-0 sm:items-center sm:p-4"
      panelClassName="max-h-[85dvh] max-w-2xl rounded-t-xl sm:rounded-xl"
    >
        <div className="border-border flex gap-1 border-b px-3 py-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "queue"}
            onClick={() => setTab("queue")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              tab === "queue" ? "bg-accent/60 text-foreground" : "text-muted-foreground",
            )}
          >
            Queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "base"}
            onClick={() => setTab("base")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              tab === "base" ? "bg-accent/60 text-foreground" : "text-muted-foreground",
            )}
          >
            Base
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "base" ? (
            base ? (
              <MarkdownLazy text={stripFrontmatter(base.text)} />
            ) : (
              <div className="text-muted-foreground py-8 text-center text-xs">
                {baseLoading ? "Loading…" : "No vault in this workspace."}
              </div>
            )
          ) : open.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-xs">
              No open questions.
            </div>
          ) : (
            <div className="space-y-2">
              {open.map((item) => {
                const deferred = (snooze[item.id] ?? 0) > now;
                const busy = busyId === item.id;
                const sent = sentId === item.id;
                const noteOpen = note?.path === item.note;
                return (
                  <div key={item.id} className="border-border bg-card/60 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          item.kind === "feature" ? "bg-success" : "bg-spark",
                        )}
                      />
                      <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                        {item.kind === "feature" ? "Acceptance" : "Vision"}
                      </span>
                      <span className="text-muted-foreground/70 text-[10px]">
                        {ageLabel(item.created, now)}
                      </span>
                      {deferred && (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
                          <Clock className="size-3" /> later
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-medium">{item.title}</div>
                    {item.quote && (
                      <blockquote className="text-muted-foreground border-border mt-1 border-l-2 pl-2 text-xs italic">
                        {item.quote}
                      </blockquote>
                    )}
                    {item.body && <div className="mt-1.5 text-xs leading-5">{item.body}</div>}
                    {item.note && (
                      <button
                        type="button"
                        onClick={() => onOpenNote(item)}
                        className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-[11px] underline underline-offset-2"
                      >
                        <FileText className="size-3" />
                        {item.note}
                      </button>
                    )}
                    {noteOpen && note && (
                      <div className="border-border bg-background mt-2 max-h-64 overflow-y-auto rounded-md border p-2">
                        <MarkdownLazy text={stripFrontmatter(note.text)} className="text-xs" />
                      </div>
                    )}

                    {rejectId === item.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={rejectText}
                          onChange={(event) => setRejectText(event.target.value)}
                          rows={2}
                          autoFocus
                          placeholder={
                            item.kind === "feature"
                              ? "What is wrong? Your words become a task."
                              : "What did you mean?"
                          }
                          className="border-border bg-background focus-visible:ring-ring w-full resize-none rounded-md border px-2 py-1.5 text-xs outline-none focus-visible:ring-1"
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" size="xs" onClick={() => setRejectId(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="xs"
                            onClick={() => sendReject(item)}
                            disabled={!rejectText.trim() || busy}
                          >
                            Send
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Button
                          size="xs"
                          onClick={() => onAction(item, "accept")}
                          disabled={busy}
                        >
                          <Check />
                          {busy ? "Sending…" : item.kind === "feature" ? "Accept" : "Yes, that's it"}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => startReject(item)}
                          disabled={busy}
                        >
                          {item.kind === "feature" ? "Doesn't work" : "Not quite"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onAction(item, "later")}
                          disabled={busy}
                        >
                          Later
                        </Button>
                        {sent && (
                          <span className="text-muted-foreground text-[10px]">
                            Sent to the review agent
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </Modal>
  );
}
