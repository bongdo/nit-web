import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import type { ComposerCommand } from "./Composer";

export function CommandPalette({
  open,
  items,
  selected,
  onSelect,
  onHighlight,
  onDismiss,
}: {
  open: boolean;
  items: ComposerCommand[];
  selected: number;
  onSelect: (id: string) => void;
  onHighlight: (index: number) => void;
  onDismiss: () => void;
}) {
  const [frozen, setFrozen] = useState(items);
  const [highlight, setHighlight] = useState({ top: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (open) setFrozen(items);
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onDismiss]);

  const shown = open ? items : frozen;
  const active = Math.min(selected, Math.max(0, shown.length - 1));

  useLayoutEffect(() => {
    if (!open) return;
    const row = rowRefs.current[active];
    if (!row) return;
    const next = { top: row.offsetTop, height: row.offsetHeight };
    setHighlight((current) =>
      current.top === next.top && current.height === next.height ? current : next,
    );
  }, [active, open, shown]);

  return (
    <div
      ref={root}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      className="palette-sheen-panel border-border bg-popover absolute inset-x-2 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border p-1 shadow-lg"
    >
      <div className="relative">
        <span
          aria-hidden
          className="palette-sheen-highlight"
          style={{ height: `${highlight.height}px`, transform: `translateY(${highlight.top}px)` }}
        >
          <span key={`sweep-${active}`} className="palette-sheen-sweep" />
        </span>
        {shown.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              rowRefs.current[index] = node;
            }}
            type="button"
            onFocus={() => onHighlight(index)}
            onMouseEnter={() => onHighlight(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item.id);
            }}
            className={cn(
              "relative z-10 flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left",
              index === active && "text-foreground",
            )}
          >
            <span className="font-mono text-xs">/{item.id}</span>
            <span className="text-muted-foreground truncate text-[11px]">{item.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
