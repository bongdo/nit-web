import { memo, useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { thinkingPreview } from "../lib/activity";
import type { ReasoningPart } from "../lib/types";

export const Reasoning = memo(function Reasoning({
  part,
  streaming,
  onLoad,
}: {
  part: ReasoningPart;
  streaming?: boolean;
  onLoad?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const preview = thinkingPreview(part.text);
  return (
    <details
      className="group"
      onToggle={(event) => {
        if (!event.currentTarget.open || !part.light || !onLoad || loading) return;
        setLoading(true);
        Promise.resolve()
          .then(() => onLoad())
          .finally(() => setLoading(false));
      }}
    >
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1 text-[11px] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <Brain className="text-muted-foreground size-3.5 shrink-0" />
        <span className={streaming ? "shrink-0 text-foreground" : "text-muted-foreground shrink-0"}>
          {streaming ? "Thinking" : "Thought"}
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">{preview}</span>
        {loading && <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />}
      </summary>
      <div className="border-border text-muted-foreground mr-2 mb-1 ml-7 border-l-2 py-1 pl-3 text-xs leading-5 whitespace-pre-wrap">
        {part.text}
        {part.light && <span className="text-muted-foreground/70"> …</span>}
      </div>
    </details>
  );
});
