import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
    askRange: { start: number; end: number } | null;
    onRect: (rect: HintRect | null) => void;
  }
>(function ComposerHighlights({ value, issues, active, askRange, onRect }, ref) {
  const layerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const askRef = useRef<HTMLSpanElement>(null);
  const lastAsk = useRef<HintRect | null>(null);
  const wasAsk = useRef(false);
  const [leaving, setLeaving] = useState<HintRect | null>(null);
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

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const span = askRef.current;
    if (askRange && span && layer) {
      const base = layer.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      lastAsk.current = {
        left: rect.left - base.left,
        top: rect.top - base.top,
        width: rect.width,
        height: rect.height,
      };
      wasAsk.current = true;
      return;
    }
    if (!askRange && wasAsk.current && lastAsk.current) {
      wasAsk.current = false;
      setLeaving(lastAsk.current);
    }
  }, [askRange, value]);

  useLayoutEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 140);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const parts: ReactNode[] = [];
  let cursor = 0;
  const ask =
    askRange && askRange.start >= 0 && askRange.end <= value.length ? askRange : null;
  if (ask) {
    if (ask.start > 0) parts.push(value.slice(0, ask.start));
    parts.push(
      <span key="ask" ref={askRef} className="ask-sheen-word">
        {value.slice(ask.start, ask.end)}
        <span className="ask-sheen-chip" aria-hidden="true">
          Ask
        </span>
      </span>,
    );
    cursor = ask.end;
  }
  for (const issue of issues) {
    if (issue.start < cursor || issue.end > value.length) continue;
    if (issue.start > cursor) parts.push(value.slice(cursor, issue.start));
    const isActive = active?.start === issue.start && active.end === issue.end;
    parts.push(
      <span
        key={`${issue.start}:${issue.end}`}
        ref={isActive ? activeRef : undefined}
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
      ref={layerRef}
      aria-hidden="true"
      className={cn(
        COMPOSER_TEXT,
        "pointer-events-none absolute inset-0 z-10 select-none overflow-hidden whitespace-pre-wrap break-words text-transparent",
      )}
    >
      {parts}
      {leaving && !ask && (
        <span
          className="ask-sheen-chip ask-sheen-chip-leaving"
          style={{
            left: leaving.left,
            top: leaving.top,
            width: leaving.width,
            height: leaving.height,
          }}
          aria-hidden="true"
        >
          Ask
        </span>
      )}
    </div>
  );
});
