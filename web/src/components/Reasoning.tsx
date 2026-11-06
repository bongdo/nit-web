import { memo, useEffect, useId, useRef, useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { thinkingPreview } from "../lib/activity";
import type { ReasoningPart } from "../lib/types";
import { cn } from "../lib/utils";

export const Reasoning = memo(function Reasoning({
  part,
  streaming,
  onLoad,
}: {
  part: ReasoningPart;
  streaming?: boolean;
  onLoad?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const wasStreaming = useRef(Boolean(streaming));
  const id = useId();
  const preview = thinkingPreview(part.text);

  useEffect(() => {
    if (wasStreaming.current && !streaming) setSettled(true);
    wasStreaming.current = Boolean(streaming);
  }, [streaming]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || !part.light || !onLoad || loading) return;
    setLoading(true);
    Promise.resolve()
      .then(() => onLoad())
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="hover:bg-muted/40 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px]"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <Brain className="text-muted-foreground size-3.5 shrink-0" />
        <span className={streaming ? "shrink-0 text-foreground" : "text-muted-foreground shrink-0"}>
          <span className={streaming ? "row-sheen-thinking" : settled ? "row-sheen-thought" : ""}>
            {streaming ? "Thinking" : "Thought"}
          </span>
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">{preview}</span>
        {loading && <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />}
      </button>
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
              "border-border text-muted-foreground mr-2 mb-1 ml-7 border-l-2 py-1 pl-3 text-xs leading-5 whitespace-pre-wrap transition-opacity duration-200 motion-reduce:transition-none",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            {part.text}
            {part.light && <span className="text-muted-foreground/70"> …</span>}
          </div>
        </div>
      </div>
    </div>
  );
});
