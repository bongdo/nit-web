import {
  ArrowLeft,
  Folder,
  Loader2,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Health, Model, ModelRef, Session } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import type { StreamStatus } from "../hooks/useEventStream";
import { basename, formatCost, modelLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { SubagentMenu } from "./SubagentMenu";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") return <Sun />;
  if (theme === "dark") return <Moon />;
  return <Monitor />;
}

export function Header({
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
  theme,
  collapsed,
  sidebarMode,
  subagents,
  parent,
  onOpenSubagent,
  onBack,
  onSettings,
  onToggleSidebar,
  onTheme,
  onMenu,
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
  theme: Theme;
  collapsed: boolean;
  sidebarMode: "button" | "hover" | "swipe";
  subagents: Session[];
  parent?: Session | null;
  onOpenSubagent: (session: Session) => void;
  onBack: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
  onTheme: () => void;
  onMenu: () => void;
}) {
  const directory = session?.location?.directory ?? fallbackDirectory;
  const title = session?.title?.trim() || (session ? "New chat" : "nit-gui");
  const live = streamStatus === "online" && health?.ok;

  const pill = "border-border/60 bg-card/90 rounded-lg border shadow-sm backdrop-blur-2xl";

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-2.5 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(pill, "pointer-events-auto size-9 md:hidden")}
        onClick={onMenu}
        aria-label="Open sessions"
      >
        <Menu />
      </Button>
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

      <div className={cn(pill, "pointer-events-auto min-w-0 max-w-2xl px-3.5 py-1")}>
        <h1 className="truncate text-[13px] font-semibold leading-tight">{title}</h1>
        <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-[10px] leading-tight">
          <Folder className="size-3 shrink-0" />
          <span className="truncate" title={directory ?? undefined}>
            {directory ? basename(directory) : "no directory"}
          </span>
          {(agent || model) && (
            <span className="truncate">
              · {agent ?? "agent"} · {modelLabel(model, models) || "model"}
            </span>
          )}
          {contextPercent != null && (
            <span className="shrink-0" title="Context used">
              · ctx {contextPercent}%
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

      <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
        {parent ? (
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
        ) : (
          <SubagentMenu sessions={subagents} onOpen={onOpenSubagent} className={pill} />
        )}

        <span
          className={cn(
            pill,
            "inline-flex size-9 items-center justify-center",
            live
              ? "text-emerald-500"
              : streamStatus === "connecting"
                ? "text-amber-500"
                : "text-destructive",
          )}
          title={
            live
              ? `Live · ${health?.server ?? ""}`
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
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(pill, "size-9")}
          onClick={onSettings}
          aria-label="Settings"
        >
          <Settings />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(pill, "size-9")}
          onClick={onTheme}
          title={`Theme: ${theme}`}
          aria-label={`Theme: ${theme}`}
        >
          <ThemeIcon theme={theme} />
        </Button>
      </div>
    </header>
  );
}
