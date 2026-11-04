import { Brain, ChevronRight } from "lucide-react";
import type { ReasoningPart } from "../lib/types";

export function Reasoning({ part, streaming }: { part: ReasoningPart; streaming?: boolean }) {
  return (
    <details className="group my-2">
      <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1.5 text-xs transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <Brain className="size-3.5" />
        {streaming ? "Thinking…" : "Thinking"}
      </summary>
      <div className="border-border text-muted-foreground mt-2 border-l-2 pl-3 text-xs leading-6 whitespace-pre-wrap">
        {part.text}
      </div>
    </details>
  );
}
