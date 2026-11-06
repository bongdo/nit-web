import { useEffect, useRef, useState } from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import type { Health } from "../lib/types";
import type { StreamStatus } from "../hooks/useEventStream";
import { cn } from "../lib/utils";

export function ConnectionStatus({
  health,
  streamStatus,
  className,
}: {
  health: Health | null;
  streamStatus: StreamStatus;
  className?: string;
}) {
  const live = streamStatus === "online" && health?.ok;
  const wasLive = useRef(Boolean(live));
  const booted = useRef(false);
  const [reconnected, setReconnected] = useState(0);
  const liveTitle = ["Live", health?.version && `OpenCode ${health.version}`, health?.server]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      wasLive.current = Boolean(live);
      return;
    }
    if (live && !wasLive.current) setReconnected((count) => count + 1);
    wasLive.current = Boolean(live);
  }, [live]);

  return (
    <span
      className={cn(
        "chrome-sheen-health relative inline-flex size-8 shrink-0 items-center justify-center rounded-md",
        live
          ? "text-success"
          : streamStatus === "connecting"
            ? "text-attention"
            : "text-destructive",
        !live && streamStatus !== "connecting" && "chrome-sheen-health-offline",
        className,
      )}
      title={
        live
          ? liveTitle
          : streamStatus === "connecting"
            ? "Connecting to event stream"
            : (health?.error ?? "Service offline")
      }
    >
      {streamStatus === "connecting" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : live ? (
        <Wifi className="size-3.5" />
      ) : (
        <WifiOff className="size-3.5" />
      )}
      {reconnected > 0 && (
        <span key={reconnected} aria-hidden className="chrome-sheen-health-sweep" />
      )}
    </span>
  );
}
