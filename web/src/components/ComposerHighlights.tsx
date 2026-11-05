import { forwardRef, type ReactNode } from "react";
import type { SpellIssue } from "../lib/spell";
import { cn } from "../lib/utils";

export const COMPOSER_TEXT = "px-4 py-3 text-[15px] leading-[1.5] [tab-size:8] [overflow-wrap:break-word]";

export const ComposerHighlights = forwardRef<
  HTMLDivElement,
  { value: string; issues: SpellIssue[] }
>(function ComposerHighlights({ value, issues }, ref) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.start < cursor || issue.end > value.length) continue;
    if (issue.start > cursor) parts.push(value.slice(cursor, issue.start));
    parts.push(
      <span
        key={`${issue.start}:${issue.end}`}
        style={{
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
      ref={ref}
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
