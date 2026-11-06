import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Folder,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Health, Model, ModelRef, Session } from "../lib/types";
import type { StreamStatus } from "../hooks/useEventStream";
import { basename, formatCost, modelLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { SubagentMenu } from "./SubagentMenu";

function ContextMeter({ value, session }: { value: number; session?: string }) {
  const previous = useRef<number | null>(null);
  const scope = useRef(session);
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    if (scope.current !== session) {
      scope.current = session;
      previous.current = value;
      return;
    }
    const last = previous.current;
    previous.current = value;
    if (last !== null && last - value >= 8) setSweep((count) => count + 1);
  }, [session, value]);

  return (
    <span
      role="progressbar"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn(
        "chrome-sheen-context bg-muted-foreground/20 relative inline-flex h-[3px] w-10 shrink-0 overflow-hidden rounded-full",
        value > 80 && "chrome-sheen-context-hot",
      )}
    >
      <span
        className="chrome-sheen-context-fill h-full w-full rounded-full"
        style={{ transform: `scaleX(${value / 100})` }}
      />
      {sweep > 0 && <span key={sweep} aria-hidden className="chrome-sheen-context-sweep" />}
    </span>
  );
}

function ModelChip({ label }: { label: string }) {
  const shownRef = useRef(label);
  const [shown, setShown] = useState(label);
  const [previous, setPrevious] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const current = shownRef.current;
    if (label === current) return;
    shownRef.current = label;
    setShown(label);
    setPrevious(current);
    setTick((count) => count + 1);
    const timer = window.setTimeout(() => setPrevious(null), 260);
    return () => window.clearTimeout(timer);
  }, [label]);

  return (
    <span className="chrome-sheen-chip inline-block max-w-full min-w-0 truncate align-bottom">
      {previous !== null && (
        <span
          key={`out-${tick}`}
          aria-hidden
          className="chrome-sheen-chip-out absolute inset-0 truncate"
        >
          · {previous}
        </span>
      )}
      <span key={`in-${tick}`} className="chrome-sheen-chip-in block truncate">
        · {shown}
      </span>
    </span>
  );
}

const pill = "border-border/60 bg-card/90 rounded-lg border shadow-sm backdrop-blur-2xl";

export function SessionPill({
  session,
  directory: fallbackDirectory,
  models,
  model,
  agent,
  contextPercent,
  cost,
  estimatedCost,
  className,
}: {
  session: Session | null;
  directory?: string | null;
  models: Model[];
  model: ModelRef | null;
  agent: string | null;
  contextPercent?: number | null;
  cost?: number;
  estimatedCost?: boolean;
  className?: string;
}) {
  const directory = session?.location?.directory ?? fallbackDirectory;
  const title = session?.title?.trim() || (session ? "New chat" : "nit-gui");
  return (
    <div className={cn(pill, "min-w-0 overflow-hidden px-3.5 py-1", className)}>
      <h1 className="truncate text-[13px] font-semibold leading-tight">{title}</h1>
      <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-[10px] leading-tight">
        <Folder className="size-3 shrink-0" />
        <span className="truncate" title={directory ?? undefined}>
          {directory ? basename(directory) : "no directory"}
        </span>
        {(agent || model) && (
          <ModelChip label={`${agent ?? "agent"} · ${modelLabel(model, models) || "model"}`} />
        )}
        {contextPercent != null && (
          <span className="flex shrink-0 items-center gap-1" title="Context used">
            <span>· ctx {contextPercent}%</span>
            <ContextMeter value={contextPercent} session={session?.id} />
          </span>
        )}
        {(cost ?? 0) > 0 && (
          <span className="shrink-0" title={estimatedCost ? "Estimated cost" : "Session cost"}>
            · {estimatedCost ? "~" : ""}
            {formatCost(cost)}
          </span>
        )}
      </div>
    </div>
  );
}

export const Header = memo(function Header({
  session,
  directory: fallbackDirectory,
  models,
  model,
  agent,
  contextPercent,
  cost,
  estimatedCost,
  health,
  streamStatus,
  collapsed,
  sidebarMode,
  subagents,
  parent,
  onOpenSubagent,
  onBack,
  onToggleSidebar,
}: {
  session: Session | null;
  directory?: string | null;
  models: Model[];
  model: ModelRef | null;
  agent: string | null;
  contextPercent?: number | null;
  cost?: number;
  estimatedCost?: boolean;
  health: Health | null;
  streamStatus: StreamStatus;
  collapsed: boolean;
  sidebarMode: "button" | "hover" | "swipe";
  subagents: Session[];
  parent?: Session | null;
  onOpenSubagent: (session: Session) => void;
  onBack: () => void;
  onToggleSidebar: () => void;
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
    <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-2.5 py-2">
      {sidebarMode !== "hover" && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(pill, "pointer-events-auto hidden size-9 md:inline-flex")}
          onClick={onToggleSidebar}
          title={collapsed ? "Show chats" : "Hide chats"}
          aria-label={collapsed ? "Show chats" : "Hide chats"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      )}

      <SessionPill
        session={session}
        directory={fallbackDirectory}
        models={models}
        model={model}
        agent={agent}
        contextPercent={contextPercent}
        cost={cost}
        estimatedCost={estimatedCost}
        className="pointer-events-auto max-w-2xl max-md:hidden"
      />

      <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
        {parent && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(pill, "h-9")}
            onClick={onBack}
            title="Back to parent"
          >
            <ArrowLeft />
            Parent
          </Button>
        )}
        {!parent && (
          <SubagentMenu
            sessions={subagents}
            onOpen={onOpenSubagent}
            className={cn(pill, "hidden md:inline-flex")}
          />
        )}

        <div className="hidden items-center gap-2 md:flex">
          <span
            className={cn(
              pill,
              "chrome-sheen-health inline-flex size-9 items-center justify-center",
              live
                ? "text-success"
                : streamStatus === "connecting"
                  ? "text-attention"
                  : "text-destructive",
              !live && streamStatus !== "connecting" && "chrome-sheen-health-offline",
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
        </div>
      </div>
    </header>
  );
});
