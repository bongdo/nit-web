import { useEffect, useRef, useState } from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import type { Health } from "../lib/types";
import type { StreamStatus } from "../hooks/useEventStream";
import { cn } from "../lib/utils";

export function ConnectionStatus({
  health,
  streamStatus,
  instance,
  onOpen,
  className,
}: {
  health: Health | null;
  streamStatus: StreamStatus;
  instance?: string;
  onOpen?: () => void;
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

  const stateTitle = live
    ? liveTitle
    : streamStatus === "connecting"
      ? "Connecting to event stream"
      : (health?.error ?? "Service offline");
  const title = [stateTitle, instance, onOpen && "OpenCode instances; click to switch"]
    .filter(Boolean)
    .join(" · ");
  const classes = cn(
    "chrome-sheen-health relative inline-flex size-8 shrink-0 items-center justify-center rounded-md",
    live
      ? "text-success"
      : streamStatus === "connecting"
        ? "text-attention"
        : "text-destructive",
    !live && streamStatus !== "connecting" && "chrome-sheen-health-offline",
    onOpen && "cursor-pointer transition-colors hover:bg-accent/60",
    className,
  );
  const content = (
    <>
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
    </>
  );

  if (!onOpen) {
    return (
      <span className={classes} title={stateTitle}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={classes}
      title={title}
      aria-label={`OpenCode instances${instance ? `: ${instance}` : ""}`}
    >
      {content}
    </button>
  );
}
