import {
  Check,
  Clock,
  Cpu,
  Globe2,
  Layers,
  MessageSquare,
  Palette,
  Pencil,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Agent, Model, ModelRef } from "../lib/types";
import { THEMES, type Theme } from "../lib/themes";
import { BACKGROUNDS } from "../lib/backgrounds";
import type { SceneSetting } from "./Scene";
import type { TimeFormat } from "../lib/time";
import { modelKey } from "../lib/format";
import { appPath } from "../lib/base";
import { SCOPES, type Scope } from "../lib/sessions";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs leading-tight font-medium">{label}</div>
        {hint && (
          <div className="text-muted-foreground mt-0.5 text-[10px] leading-tight">{hint}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
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
  notify,
  scopes,
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
  onNotify,
  onScopes,
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
  notify: boolean;
  scopes: Scope[];
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
  onNotify: () => void;
  onScopes: (id: Scope) => void;
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
        className="overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Settings</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close settings">
            <X />
          </Button>
        </div>

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

          <Section icon={Cpu} title="Model & agent" wide>
            <Field label="Workspace" hint="Where new chats start">
              <span
                className="border-border bg-muted/30 max-w-[240px] truncate rounded-md border px-2 py-1 font-mono text-[10px]"
                title={directory ?? undefined}
              >
                {directory ?? "none"}
              </span>
            </Field>
            <Field label="Model" hint="Default for this browser">
              <Select
                className="w-[220px]"
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
            </Field>
            {model && variants.length > 0 && (
              <Field label="Reasoning" hint="Variant for this model">
                <Select
                  className="w-[220px]"
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
              </Field>
            )}
            <Field label="Agent" hint="Used for new messages">
              <Select
                className="w-[220px]"
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
            </Field>
          </Section>

          <Section icon={Pencil} title="Writing">
            <Field label="Spelling & grammar" hint="RU + EN, grammar if configured">
              <Toggle
                on={spellcheck}
                onChange={onSpellcheck}
                label="Spelling and grammar"
              />
            </Field>
            <Field label="Auto-fix typos" hint="Only unambiguous lowercase words">
              <Toggle on={autofix} onChange={onAutofix} label="Auto-fix typos" />
            </Field>
          </Section>

          <Section icon={Palette} title="Appearance">
            <Field label="Theme">
              <Select
                className="w-[160px]"
                value={theme}
                onChange={(event) => onTheme(event.target.value as Theme)}
              >
                {THEMES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Background">
              <Select
                className="w-[160px]"
                value={background}
                onChange={(event) => onBackground(event.target.value as SceneSetting)}
              >
                {BACKGROUNDS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.menu}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motion" hint="Row and panel transitions">
              <Toggle
                on={motion === "animated"}
                onChange={(on) => onMotion(on ? "animated" : "static")}
                label="Animated motion"
              />
            </Field>
          </Section>

          <Section icon={Clock} title="Time & alerts">
            <Field label="Time format">
              <Select
                className="w-[160px]"
                value={timeFormat}
                onChange={(event) => onTimeFormat(event.target.value as TimeFormat)}
              >
                <option value="24h">24-hour · 13:05</option>
                <option value="12h">12-hour · 1:05 PM</option>
              </Select>
            </Field>
            <Field label="Message time" hint="Show the clock on messages">
              <Toggle on={showTime} onChange={onShowTime} label="Show message time" />
            </Field>
            <Field label="Desktop notifications" hint="Waiting and finished chats">
              <Toggle
                on={notify}
                onChange={() => onNotify()}
                label="Desktop notifications"
              />
            </Field>
          </Section>
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
