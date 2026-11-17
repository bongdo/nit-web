import {
  Check,
  ChevronRight,
  Clock,
  Cpu,
  Globe2,
  Layers,
  MessageSquare,
  Palette,
  Pencil,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Agent, Model, ModelRef } from "../lib/types";
import { THEMES, themeLabel, type Theme } from "../lib/themes";
import { BACKGROUNDS } from "../lib/backgrounds";
import { Scene, type SceneSetting } from "./Scene";
import type { TimeFormat } from "../lib/time";
import { modelKey } from "../lib/format";
import { SCOPES, type Scope } from "../lib/sessions";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Modal } from "./ui/Modal";
import { Field, Pick, type PickOption } from "./ui/pick";

const VIEW_ICONS: Record<Scope, LucideIcon> = {
  directory: MessageSquare,
  mine: Layers,
  everywhere: Globe2,
};

const VIEW_HINTS: Record<Scope, string> = {
  directory: "Only chats started in the current workspace.",
  mine: "Every chat on this machine, grouped by directory.",
  everywhere: "Chats from this machine and every connected instance.",
};

function Section({
  icon: Icon,
  title,
  hint,
  wide,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "bg-card/40 border-border/70 self-start rounded-xl border p-3",
        wide && "sm:col-span-2",
      )}
    >
      <header className="mb-2.5 flex items-center gap-2">
        <span className="bg-accent/60 text-foreground flex size-6 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider">{title}</h3>
        {hint && (
          <span className="text-muted-foreground ml-auto min-w-0 truncate text-[10px]">{hint}</span>
        )}
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "focus-visible:ring-ring relative h-5 w-9 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 disabled:opacity-40",
        on ? "bg-primary border-primary" : "bg-muted border-border",
      )}
    >
      <span
        className={cn(
          "bg-background absolute top-0.5 left-0.5 size-3.5 rounded-full shadow-sm transition-transform",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

function PickerTile({
  label,
  value,
  hint,
  preview,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  preview: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}`}
      className="border-border/70 hover:border-ring/50 hover:bg-accent/30 flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors"
    >
      {preview}
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">
          {label}
        </span>
        <span className="block truncate text-xs font-medium">{value}</span>
        {hint && (
          <span className="text-muted-foreground block truncate text-[10px]">{hint}</span>
        )}
      </span>
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  );
}

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
  showSteps,
  motion,
  background,
  notify,
  scopes,
  instance,
  onModel,
  onAgent,
  onSpellcheck,
  onAutofix,
  onTimeFormat,
  onShowTime,
  onShowSteps,
  onMotion,
  onNotify,
  onScopes,
  onOpenTheme,
  onOpenBackground,
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
  showSteps: boolean;
  motion: "animated" | "static";
  background: SceneSetting;
  notify: boolean;
  scopes: Scope[];
  instance: string;
  onModel: (model: ModelRef) => void;
  onAgent: (agent: string) => void;
  onSpellcheck: (value: boolean) => void;
  onAutofix: (value: boolean) => void;
  onTimeFormat: (value: TimeFormat) => void;
  onShowTime: (value: boolean) => void;
  onShowSteps: (value: boolean) => void;
  onMotion: (mode: "animated" | "static") => void;
  onNotify: () => void;
  onScopes: (id: Scope) => void;
  onOpenTheme: () => void;
  onOpenBackground: () => void;
  onInstances: () => void;
  onClose: () => void;
}) {
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
  const modelOptions: PickOption[] = models
    .filter((item) => item.enabled)
    .map((item) => ({ value: modelKey(item), label: item.name, group: item.providerID }));
  if (model && !modelOptions.some((item) => item.value === modelKey(model))) {
    modelOptions.unshift({ value: modelKey(model), label: model.id, group: model.providerID });
  }
  const scene = BACKGROUNDS.find((item) => item.id === background);

  return (
    <Modal
      label="Settings"
      closeLabel="Close settings"
      title={<h2 className="text-sm font-semibold">Settings</h2>}
      onClose={onClose}
      panelClassName="max-w-3xl"
    >
        <div className="scrollbar-thin grid min-h-0 gap-3 overflow-y-auto p-3 sm:grid-cols-2">
          <Section
            icon={Layers}
            title="Chat views"
            hint={`${scopes.length} of ${SCOPES.length} on`}
            wide
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {SCOPES.map((item) => {
                const Icon = VIEW_ICONS[item.id];
                const on = scopes.includes(item.id);
                const locked = on && scopes.length === 1;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => onScopes(item.id)}
                    title={locked ? "At least one view must stay on" : undefined}
                    className={cn(
                      "group relative flex items-start gap-2 rounded-lg border p-2 text-left transition-all",
                      on
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/70 hover:border-border hover:bg-accent/40",
                      locked && "cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="truncate">{item.label}</span>
                        {on && <Check className="text-primary size-3 shrink-0" />}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[10px] leading-snug">
                        {VIEW_HINTS[item.id]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[10px]">
              Pick what shows up in the sidebar switcher. One view always stays on.
            </p>
          </Section>

          <Section icon={Cpu} title="Session defaults" wide>
            <Field label="Workspace" hint="Where new chats start">
              <span
                className="border-border bg-muted/30 max-w-[260px] truncate rounded-md border px-2 py-1 font-mono text-[10px]"
                title={directory ?? undefined}
              >
                {directory ?? "none"}
              </span>
            </Field>
            <Field label="Model" hint="Default for this browser">
              <Pick
                label="Model"
                value={model ? modelKey(model) : ""}
                placeholder="Default model"
                options={modelOptions}
                onChange={(value) => {
                  const [providerID, ...rest] = value.split("/");
                  const id = rest.join("/");
                  if (!providerID || !id) return;
                  const supported = models
                    .find((item) => item.id === id && item.providerID === providerID)
                    ?.variants.some((item) => item.id === model?.variant);
                  onModel({ id, providerID, variant: supported ? model?.variant : undefined });
                }}
              />
            </Field>
            {model && variants.length > 0 && (
              <Field label="Reasoning" hint="Variant for this model">
                <Pick
                  label="Reasoning"
                  value={model.variant ?? ""}
                  placeholder="Default"
                  options={[
                    { value: "", label: "Default" },
                    ...variants.map((item) => ({ value: item.id, label: item.id })),
                  ]}
                  onChange={(value) => onModel({ ...model, variant: value || undefined })}
                />
              </Field>
            )}
            <Field label="Agent" hint="Used for new messages">
              <Pick
                label="Agent"
                value={agent ?? ""}
                placeholder="Agent"
                options={primaryAgents.map((item) => ({ value: item.id, label: item.name }))}
                onChange={onAgent}
              />
            </Field>
            <Field label="Instances" hint={`Connected as ${instance}`}>
              <Button variant="outline" size="sm" onClick={onInstances}>
                Manage
              </Button>
            </Field>
          </Section>

          <Section icon={Palette} title="Appearance" wide>
            <div className="grid gap-2 sm:grid-cols-2">
              <PickerTile
                label="Theme"
                value={themeLabel(theme)}
                hint={THEMES.find((item) => item.id === theme)?.hint}
                preview={
                  <span
                    data-theme={theme === "system" ? undefined : theme}
                    className="border-border bg-background text-foreground flex size-9 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold"
                  >
                    Aa
                  </span>
                }
                onClick={onOpenTheme}
              />
              <PickerTile
                label="Background"
                value={scene?.label ?? background}
                hint={scene?.hint}
                preview={
                  <span className="border-border relative block size-9 shrink-0 overflow-hidden rounded-md border">
                    {background === "random" ? (
                      <span className="from-primary/25 via-spark/15 to-success/25 grid size-full place-items-center bg-linear-to-br">
                        <Shuffle className="size-3.5" />
                      </span>
                    ) : (
                      <Scene
                        variant={background}
                        motion="static"
                        preview
                        className="[mask-image:none]"
                      />
                    )}
                  </span>
                }
                onClick={onOpenBackground}
              />
            </div>
            <Field label="Motion" hint="Row and panel transitions">
              <Toggle
                on={motion === "animated"}
                onChange={(on) => onMotion(on ? "animated" : "static")}
                label="Animated motion"
              />
            </Field>
          </Section>

          <Section icon={MessageSquare} title="Chat">
            <Field label="Agent steps" hint="Reasoning and tool calls">
              <Toggle on={showSteps} onChange={onShowSteps} label="Show agent steps" />
            </Field>
            <Field label="Message time" hint="Show the clock on messages">
              <Toggle on={showTime} onChange={onShowTime} label="Show message time" />
            </Field>
          </Section>

          <Section icon={Pencil} title="Writing">
            <Field label="Spelling & grammar" hint="RU + EN, grammar if configured">
              <Toggle on={spellcheck} onChange={onSpellcheck} label="Spelling and grammar" />
            </Field>
            <Field label="Auto-fix typos" hint="Only unambiguous lowercase words">
              <Toggle on={autofix} onChange={onAutofix} label="Auto-fix typos" />
            </Field>
          </Section>

          <Section icon={Clock} title="Time & alerts">
            <Field label="Time format">
              <Pick
                label="Time format"
                value={timeFormat}
                placeholder="Time format"
                width="w-[150px] max-sm:w-full"
                options={[
                  { value: "24h", label: "24-hour", hint: "13:05" },
                  { value: "12h", label: "12-hour", hint: "1:05 PM" },
                ]}
                onChange={(value) => onTimeFormat(value as TimeFormat)}
              />
            </Field>
            <Field label="Desktop notifications" hint="Waiting and finished chats">
              <Toggle on={notify} onChange={() => onNotify()} label="Desktop notifications" />
            </Field>
          </Section>
        </div>
    </Modal>
  );
}
