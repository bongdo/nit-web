import { memo } from "react";
import type { ReasoningPart, ToolPart } from "../lib/types";
import { cn } from "../lib/utils";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";

export type ActivityPart = ReasoningPart | ToolPart;

function statusDot(part: ActivityPart): string {
  if (part.type === "reasoning") return "bg-muted-foreground/40";
  switch (part.state.status) {
    case "running":
    case "streaming":
      return "bg-success animate-pulse";
    case "completed":
      return "bg-success/60";
    case "error":
      return "bg-destructive";
    default:
      return "bg-border";
  }
}

export const ActivityLog = memo(function ActivityLog({
  activity,
  workspace,
  peroURL,
  agent,
  instance,
  sessionID,
  streaming,
}: {
  activity: ActivityPart[];
  workspace?: string | null;
  peroURL: string;
  agent?: string;
  instance?: string;
  sessionID?: string;
  streaming: boolean;
}) {
  return (
    <ol className="border-border/60 relative ml-1.5 border-l">
      {activity.map((part, index) => (
        <li
          key={part.type === "tool" ? `tool-${part.id}` : `reasoning-${index}`}
          className="relative pl-3"
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-2.5 -left-[3px] size-1.5 rounded-full",
              statusDot(part),
            )}
          />
          {part.type === "reasoning" ? (
            <Reasoning part={part} streaming={streaming && index === activity.length - 1} />
          ) : (
            <ToolCall
              part={part}
              cwd={workspace}
              peroURL={peroURL}
              agent={agent}
              instance={instance}
              sessionID={sessionID}
            />
          )}
        </li>
      ))}
    </ol>
  );
});
