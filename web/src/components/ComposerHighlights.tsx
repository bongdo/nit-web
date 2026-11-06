import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import type { SpellIssue } from "../lib/spell";
import { cn } from "../lib/utils";

export const COMPOSER_TEXT =
  "px-4 py-3 text-[15px] leading-[1.5] [tab-size:8] [overflow-wrap:break-word]";

export type HintRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const ComposerHighlights = forwardRef<
  HTMLDivElement,
  {
    value: string;
    issues: SpellIssue[];
    active: SpellIssue | null;
    onRect: (rect: HintRect | null) => void;
  }
>(function ComposerHighlights({ value, issues, active, onRect }, ref) {
  const layerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => layerRef.current as HTMLDivElement);

  useLayoutEffect(() => {
    const span = activeRef.current;
    const layer = layerRef.current;
    const wrapper = layer?.parentElement;
    if (!span || !wrapper) {
      onRect(null);
      return;
    }
    const base = wrapper.getBoundingClientRect();
    const rect = span.getBoundingClientRect();
    onRect({
      left: rect.left - base.left,
      top: rect.top - base.top,
      width: rect.width,
      height: rect.height,
    });
  }, [value, active, onRect]);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.start < cursor || issue.end > value.length) continue;
    if (issue.start > cursor) parts.push(value.slice(cursor, issue.start));
    const isActive = active?.start === issue.start && active.end === issue.end;
    parts.push(
      <span
        key={`${issue.start}:${issue.end}`}
        ref={isActive ? activeRef : undefined}
        style={{
          color: "var(--destructive)",
          textDecorationLine: "underline",
          textDecorationStyle: "wavy",
          textDecorationColor: "var(--destructive)",
          textDecorationSkipInk: "none",
        }}
      >
        {value.slice(issue.start, issue.end)}
      </span>,
    );
    cursor = issue.end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className={cn(
        COMPOSER_TEXT,
        "pointer-events-none absolute inset-0 z-10 select-none overflow-hidden whitespace-pre-wrap break-words text-transparent",
      )}
    >
      {parts}
    </div>
  );
});
