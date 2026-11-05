import { X } from "lucide-react";
import type { Agent, Model, ModelRef } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
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
  onModel,
  onAgent,
  onTheme,
  onClose,
}: {
  models: Model[];
  agents: Agent[];
  model: ModelRef | null;
  agent: string | null;
  theme: Theme;
  directory?: string | null;
  onModel: (model: ModelRef) => void;
  onAgent: (agent: string) => void;
  onTheme: (theme: Theme) => void;
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
      <div className="bg-background border-border w-full max-w-md rounded-xl border p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Settings</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close settings">
            <X />
          </Button>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
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
        </div>
      </div>
    </div>
  );
}
