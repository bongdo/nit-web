import {
  Folder,
  Loader2,
  Menu,
  Monitor,
  Moon,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Agent, Health, Model, ModelRef, Session } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import type { StreamStatus } from "../hooks/useEventStream";
import { basename, modelKey } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") return <Sun />;
  if (theme === "dark") return <Moon />;
  return <Monitor />;
}

export function Header({
  session,
  directory: fallbackDirectory,
  models,
  agents,
  model,
  agent,
  health,
  streamStatus,
  theme,
  onModel,
  onAgent,
  onTheme,
  onMenu,
}: {
  session: Session | null;
  directory?: string;
  models: Model[];
  agents: Agent[];
  model: ModelRef | null;
  agent: string | null;
  health: Health | null;
  streamStatus: StreamStatus;
  theme: Theme;
  onModel: (model: ModelRef) => void;
  onAgent: (agent: string) => void;
  onTheme: () => void;
  onMenu: () => void;
}) {
  const providers = Array.from(new Set(models.map((item) => item.providerID)));
  const primaryAgents = agents
    .filter((item) => !item.hidden && (item.mode === "primary" || item.mode === "all"))
    .sort((a, b) => (a.id === "build" ? -1 : b.id === "build" ? 1 : a.name.localeCompare(b.name)))
    .map((item) => ({ id: item.id, name: item.name }));
  if (agent && !primaryAgents.some((item) => item.id === agent)) {
    primaryAgents.unshift({ id: agent, name: agent });
  }
  const directory = session?.location?.directory ?? fallbackDirectory;
  const title = session?.title?.trim() || (session ? "New session" : "nit-gui");
  const live = streamStatus === "online" && health?.ok;

  return (
    <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 backdrop-blur">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onMenu}
        aria-label="Open sessions"
      >
        <Menu />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold leading-tight">{title}</h1>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-[10px] leading-tight">
            <Folder className="size-3 shrink-0" />
            <span className="truncate" title={directory}>
              {directory ? basename(directory) : "no directory"}
            </span>
            {session?.agent && <span className="hidden sm:inline">· {session.agent}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Select
          aria-label="Model"
          className="w-[150px] sm:w-[190px]"
          value={model ? modelKey(model) : ""}
          onChange={(event) => {
            const [providerID, ...rest] = event.target.value.split("/");
            const id = rest.join("/");
            if (providerID && id) onModel({ id, providerID });
          }}
          disabled={models.length === 0}
          title="Model"
        >
          {!model && <option value="">Default model</option>}
          {providers.map((providerID) => (
            <optgroup key={providerID} label={providerID}>
              {models
                .filter((item) => item.providerID === providerID && item.enabled)
                .map((item) => (
                  <option key={modelKey(item)} value={modelKey(item)}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>

        <Select
          aria-label="Agent"
          className="w-[105px] sm:w-[130px]"
          value={agent ?? ""}
          onChange={(event) => onAgent(event.target.value)}
          disabled={primaryAgents.length === 0}
          title="Agent"
        >
          {!agent && <option value="">Agent</option>}
          {primaryAgents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        <span
          className={cn(
            "inline-flex size-8 items-center justify-center",
            live ? "text-emerald-500" : streamStatus === "connecting" ? "text-amber-500" : "text-destructive",
          )}
          title={
            live
              ? `Live · ${health?.server ?? ""}`
              : streamStatus === "connecting"
                ? "Connecting to event stream"
                : health?.error ?? "Service offline"
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
