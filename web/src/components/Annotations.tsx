import { useEffect, useRef, useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export type AnnotationPick = {
  x: number;
  y: number;
  locator: string;
  text?: string;
};

const COMPOSER_WIDTH = 340;
const COMPOSER_HEIGHT = 190;

export function placeAnnotation(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - COMPOSER_WIDTH - 8));
  const bottom = rect.top + rect.height;
  const below = bottom + 8;
  const y =
    below + COMPOSER_HEIGHT <= window.innerHeight
      ? below
      : Math.max(8, rect.top - COMPOSER_HEIGHT - 8);
  return { x, y };
}

function snippet(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function tableLocator(cell: Element): string {
  const table = cell.closest("table");
  const row = cell.closest("tr");
  if (!table || !row) return "table cell";
  const rows = Array.from(table.querySelectorAll("tr"));
  const rowIndex = rows.indexOf(row) + 1;
  const cells = Array.from(row.children);
  const columnIndex = cells.indexOf(cell) + 1;
  const head = table.querySelector("thead tr");
  const header = head?.children[columnIndex - 1]?.textContent?.replace(/\s+/g, " ").trim();
  return `table row ${rowIndex}, column ${columnIndex}${header ? ` («${header}»)` : ""}`;
}

function locator(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === "td" || tag === "th") return tableLocator(element);
  if (tag === "pre") return "code block";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "li") return "list item";
  if (tag === "blockquote") return "quote";
  if (tag === "th") return "table header";
  return "paragraph";
}

export function AnnotationSurface({
  enabled,
  onPick,
  className,
  children,
}: {
  enabled: boolean;
  onPick: (pick: AnnotationPick) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const target = event.target as Element;
    if (target.closest("a, button, input, textarea, select, summary, label")) return;
    const block = target.closest("h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote");
    if (!block || !ref.current?.contains(block)) return;
    event.preventDefault();
    event.stopPropagation();
    ref.current
      .querySelectorAll(".nit-annotate-selected")
      .forEach((node) => node.classList.remove("nit-annotate-selected"));
    block.classList.add("nit-annotate-selected");
    const rect = block.getBoundingClientRect();
    onPick({ ...placeAnnotation(rect), locator: locator(block), text: snippet(block) });
  };

  return (
    <div ref={ref} className={cn(enabled && "cursor-crosshair", className)} onClick={onClick}>
      {children}
    </div>
  );
}

export function AnnotationComposer({
  pick,
  sending,
  error,
  onSend,
  onClose,
}: {
  pick: AnnotationPick;
  sending: boolean;
  error?: string;
  onSend: (comment: string) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setComment("");
    input.current?.focus();
  }, [pick]);

  const send = () => {
    const text = comment.trim();
    if (!text || sending) return;
    onSend(text);
  };

  return (
    <div
      className="overlay-popover border-border bg-popover text-popover-foreground fixed z-50 w-[340px] max-w-[calc(100vw-16px)] rounded-lg border p-2 shadow-xl"
      style={{ left: pick.x, top: pick.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
      }}
    >
      <div className="text-muted-foreground mb-1 truncate text-[11px]" title={pick.locator}>
        {pick.locator}
      </div>
      {pick.text && (
        <div className="bg-muted/60 mb-2 line-clamp-3 rounded px-2 py-1 text-[11px]">
          «{pick.text}»
        </div>
      )}
      <textarea
        ref={input}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="What is wrong here?"
        rows={3}
        className="border-border bg-background focus:border-ring w-full resize-none rounded-md border px-2 py-1.5 text-xs outline-none"
      />
      {error && <div className="text-destructive mt-1 text-[11px]">{error}</div>}
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button size="xs" onClick={send} disabled={sending || !comment.trim()}>
          <Send />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
