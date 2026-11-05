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
import { basename, modelLabel } from "../lib/format";
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
  health,
  streamStatus,
  theme,
  collapsed,
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
  health: Health | null;
  streamStatus: StreamStatus;
  theme: Theme;
  collapsed: boolean;
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

  return (
    <header className="border-border bg-background flex h-12 shrink-0 items-center gap-2 border-b px-2.5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onMenu}
        aria-label="Open sessions"
      >
        <Menu />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden md:inline-flex"
        onClick={onToggleSidebar}
        title={collapsed ? "Show chats" : "Hide chats"}
        aria-label={collapsed ? "Show chats" : "Hide chats"}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>

      <div className="min-w-0 flex-1">
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
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {parent ? (
          <Button variant="ghost" size="sm" onClick={onBack} title="Back to parent">
            <ArrowLeft />
            Parent
          </Button>
        ) : (
          <SubagentMenu sessions={subagents} onOpen={onOpenSubagent} />
        )}

        <span
          className={cn(
            "inline-flex size-8 items-center justify-center",
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

        <Button variant="ghost" size="icon-sm" onClick={onSettings} aria-label="Settings">
          <Settings />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
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
