import { X } from "lucide-react";
import type { Agent, Model, ModelRef } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import type { SceneSetting } from "./Scene";
import { modelKey } from "../lib/format";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

export function SettingsPanel({
  models,
  agents,
  model,
  agent,
  theme,
  directory,
  dictationMode,
  spellcheck,
  autofix,
  motion,
  background,
  sidebarMode,
  onModel,
  onAgent,
  onTheme,
  onDictation,
  onSpellcheck,
  onAutofix,
  onMotion,
  onBackground,
  onSidebar,
  onClose,
}: {
  models: Model[];
  agents: Agent[];
  model: ModelRef | null;
  agent: string | null;
  theme: Theme;
  directory?: string | null;
  dictationMode: "fast" | "accurate";
  spellcheck: boolean;
  autofix: boolean;
  motion: "animated" | "static";
  background: SceneSetting;
  sidebarMode: "button" | "hover" | "swipe";
  onModel: (model: ModelRef) => void;
  onAgent: (agent: string) => void;
  onTheme: (theme: Theme) => void;
  onDictation: (mode: "fast" | "accurate") => void;
  onSpellcheck: (value: boolean) => void;
  onAutofix: (value: boolean) => void;
  onMotion: (mode: "animated" | "static") => void;
  onBackground: (mode: SceneSetting) => void;
  onSidebar: (mode: "button" | "hover" | "swipe") => void;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl">
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
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
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
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground text-[11px]">Dictation</span>
            <Select
              className="w-full"
              value={dictationMode}
              onChange={(event) => onDictation(event.target.value as "fast" | "accurate")}
            >
              <option value="fast">Fast · live text, small model</option>
              <option value="accurate">Accurate · one pass, large model</option>
            </Select>
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
            <span className="text-muted-foreground text-[11px]">Background</span>
            <Select
              className="w-full"
              value={background}
              onChange={(event) => onBackground(event.target.value as SceneSetting)}
            >
              <option value="spotlight">Contours · spotlight</option>
              <option value="magnetic">Contours · magnetic</option>
              <option value="split">Contours · split</option>
              <option value="ripple">Contours · ripple</option>
              <option value="diagonal">Contours · diagonal</option>
              <option value="random">Random per new chat</option>
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
      </div>
    </div>
  );
}
