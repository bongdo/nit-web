import { X } from "lucide-react";
import type { Agent, Model, ModelRef } from "../lib/types";
import { THEMES, type Theme } from "../lib/themes";
import { BACKGROUNDS } from "../lib/backgrounds";
import type { SceneSetting } from "./Scene";
import type { TimeFormat } from "../lib/time";
import { modelKey } from "../lib/format";
import { appPath } from "../lib/base";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

export function SettingsPanel({
  models,
  agents,
  model,
  agent,
  theme,
  directory,
  spellcheck,
  autofix,
  timeFormat,
  showTime,
  motion,
  background,
  sidebarMode,
  notify,
  instance,
  onModel,
  onAgent,
  onTheme,
  onSpellcheck,
  onAutofix,
  onTimeFormat,
  onShowTime,
  onMotion,
  onBackground,
  onSidebar,
  onNotify,
  onInstances,
  onClose,
}: {
  models: Model[];
  agents: Agent[];
  model: ModelRef | null;
  agent: string | null;
  theme: Theme;
  directory?: string | null;
  spellcheck: boolean;
  autofix: boolean;
  timeFormat: TimeFormat;
  showTime: boolean;
  motion: "animated" | "static";
  background: SceneSetting;
  sidebarMode: "button" | "hover" | "swipe";
  notify: boolean;
  instance: string;
  onModel: (model: ModelRef) => void;
  onAgent: (agent: string) => void;
  onTheme: (theme: Theme) => void;
  onSpellcheck: (value: boolean) => void;
  onAutofix: (value: boolean) => void;
  onTimeFormat: (value: TimeFormat) => void;
  onShowTime: (value: boolean) => void;
  onMotion: (mode: "animated" | "static") => void;
  onBackground: (mode: SceneSetting) => void;
  onSidebar: (mode: "button" | "hover" | "swipe") => void;
  onNotify: () => void;
  onInstances: () => void;
  onClose: () => void;
}) {
  const providers = Array.from(new Set(models.map((item) => item.providerID)));
  const primaryAgents = agents
    .filter((item) => !item.hidden && (item.mode === "primary" || item.mode === "all"))
    .sort((a, b) => (a.id === "build" ? -1 : b.id === "build" ? 1 : a.name.localeCompare(b.name)));
  if (agent && !primaryAgents.some((item) => item.id === agent)) {
    primaryAgents.unshift({ id: agent, name: agent, mode: "primary", hidden: false });
  }
  const variants = model
    ? (models.find((item) => item.id === model.id && item.providerID === model.providerID)
        ?.variants ?? [])
    : [];
  const panel = useModalFocus<HTMLDivElement>();

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Settings</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close settings">
            <X />
          </Button>
        </div>

        <div className="scrollbar-thin grid min-h-0 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-muted-foreground text-[11px]">Workspace</span>
            <div className="border-border bg-muted/30 truncate rounded-md border px-2.5 py-1.5 font-mono text-[11px]">
              {directory ?? "none"}
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Model</span>
            <Select
              className="w-full"
              value={model ? modelKey(model) : ""}
              onChange={(event) => {
                const [providerID, ...rest] = event.target.value.split("/");
                const id = rest.join("/");
                if (!providerID || !id) return;
                const supported = models
                  .find((item) => item.id === id && item.providerID === providerID)
                  ?.variants.some((item) => item.id === model?.variant);
                onModel({ id, providerID, variant: supported ? model?.variant : undefined });
              }}
              disabled={models.length === 0}
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
          </label>

          {model && variants.length > 0 && (
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Reasoning / variant</span>
              <Select
                className="w-full"
                value={model.variant ?? ""}
                onChange={(event) =>
                  onModel({ ...model, variant: event.target.value || undefined })
                }
              >
                <option value="">Default</option>
                {model.variant && !variants.some((item) => item.id === model.variant) && (
                  <option value={model.variant}>{model.variant}</option>
                )}
                {variants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Agent</span>
            <Select
              className="w-full"
              value={agent ?? ""}
              onChange={(event) => onAgent(event.target.value)}
              disabled={primaryAgents.length === 0}
            >
              {!agent && <option value="">Agent</option>}
              {primaryAgents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Theme</span>
            <Select
              className="w-full"
              value={theme}
              onChange={(event) => onTheme(event.target.value as Theme)}
            >
              {THEMES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Chats sidebar</span>
            <Select
              className="w-full"
              value={sidebarMode}
              onChange={(event) =>
                onSidebar(event.target.value as "button" | "hover" | "swipe")
              }
            >
              <option value="button">Button + swipe</option>
              <option value="hover">Hover at the left edge</option>
              <option value="swipe">Swipe · follows fingers</option>
            </Select>
            <span className="text-muted-foreground block text-xs">
              On a tablet: drag the chats panel left to hide it, or pull right from the left edge to
              bring it back. The header button does both.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Dictation</span>
            <span className="text-muted-foreground block text-xs">
              Browser speech, words appear as you speak. Audio goes to your browser&apos;s speech
              service; Firefox falls back to the host model.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Spelling & grammar</span>
            <Select
              className="w-full"
              value={spellcheck ? "on" : "off"}
              onChange={(event) => onSpellcheck(event.target.value === "on")}
            >
              <option value="on">On · RU + EN spelling, grammar if configured</option>
              <option value="off">Off</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Auto-fix typos</span>
            <Select
              className="w-full"
              value={autofix ? "on" : "off"}
              onChange={(event) => onAutofix(event.target.value === "on")}
            >
              <option value="on">On · only unambiguous lowercase words</option>
              <option value="off">Off</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Time format</span>
            <Select
              className="w-full"
              value={timeFormat}
              onChange={(event) => onTimeFormat(event.target.value as TimeFormat)}
            >
              <option value="24h">24-hour · 13:05</option>
              <option value="12h">12-hour · 1:05 PM</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Message time</span>
            <Select
              className="w-full"
              value={showTime ? "on" : "off"}
              onChange={(event) => onShowTime(event.target.value === "on")}
            >
              <option value="on">Show</option>
              <option value="off">Hide</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Desktop notifications</span>
            <Select
              className="w-full"
              value={notify ? "on" : "off"}
              onChange={(event) => {
                if ((event.target.value === "on") !== notify) onNotify();
              }}
            >
              <option value="on">On · waiting and finished chats</option>
              <option value="off">Off</option>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Background</span>
            <Select
              className="w-full"
              value={background}
              onChange={(event) => onBackground(event.target.value as SceneSetting)}
            >
              {BACKGROUNDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.menu}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Motion</span>
            <Select
              className="w-full"
              value={motion}
              onChange={(event) => onMotion(event.target.value as "animated" | "static")}
            >
              <option value="animated">Animated</option>
              <option value="static">Static</option>
            </Select>
          </label>
        </div>

        <div className="border-border flex items-center justify-between gap-3 border-t px-4 py-3">
          <span className="text-muted-foreground truncate text-xs">nit-gui · {instance}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={onInstances}>
              Instances
            </Button>
            <form method="post" action={appPath("/auth/logout")}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
