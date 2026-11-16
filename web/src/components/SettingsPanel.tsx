import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Globe2,
  Layers,
  MessageSquare,
  Palette,
  Pencil,
  Shuffle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Agent, Model, ModelRef } from "../lib/types";
import { THEMES, themeLabel, type Theme } from "../lib/themes";
import { BACKGROUNDS } from "../lib/backgrounds";
import { Scene, type SceneSetting } from "./Scene";
import type { TimeFormat } from "../lib/time";
import { modelKey } from "../lib/format";
import { SCOPES, type Scope } from "../lib/sessions";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";

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

type Option = { value: string; label: string; hint?: string; group?: string };

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
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="text-xs leading-tight font-medium">{label}</div>
        {hint && (
          <div className="text-muted-foreground mt-0.5 text-[10px] leading-tight">{hint}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
        {children}
      </div>
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

function Pick({
  value,
  options,
  placeholder,
  label,
  width,
  onChange,
}: {
  value: string;
  options: Option[];
  placeholder: string;
  label: string;
  width?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((item) => item.value === value);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    setRect(box);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const spaceBelow = rect ? window.innerHeight - rect.bottom - 12 : 320;
  const spaceAbove = rect ? rect.top - 12 : 0;
  const estimate = Math.min(320, options.length * 32 + 12);
  const above = spaceBelow < estimate && spaceAbove > spaceBelow;
  const height = Math.max(120, Math.min(320, above ? spaceAbove : spaceBelow));
  const dropWidth = rect ? Math.min(Math.max(rect.width, 232), 320) : 232;
  const left = rect
    ? Math.max(8, Math.min(rect.right - dropWidth, window.innerWidth - dropWidth - 8))
    : 8;
  const placement = above
    ? { bottom: window.innerHeight - (rect?.top ?? 0) + 6 }
    : { top: (rect?.bottom ?? 0) + 6 };

  return (
    <div className={cn("relative min-w-0", width ?? "w-full sm:w-[220px]")}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className="border-border bg-background hover:bg-accent/50 focus-visible:ring-ring flex h-8 w-full items-center justify-between gap-2 rounded-md border px-2 text-left text-xs outline-none focus-visible:ring-2"
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? placeholder}</span>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            style={{ ...placement, left, width: dropWidth, maxHeight: height }}
            className="overlay-popover border-border bg-popover text-popover-foreground fixed z-[60] min-w-0 overflow-y-auto rounded-lg border p-1 shadow-lg"
          >
            {options.map((item, index) => {
              const heading =
                item.group && (index === 0 || options[index - 1]?.group !== item.group);
              return (
                <Fragment key={item.value || item.label}>
                  {heading && (
                    <div className="text-muted-foreground px-2 pt-1.5 pb-1 font-mono text-[9px] tracking-[0.12em] uppercase">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={item.value === value}
                    onClick={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                      item.value === value && "bg-accent/40",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{item.label}</span>
                      {item.hint && (
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {item.value === value && <Check className="text-primary size-3 shrink-0" />}
                  </button>
                </Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
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
  const modelOptions: Option[] = models
    .filter((item) => item.enabled)
    .map((item) => ({ value: modelKey(item), label: item.name, group: item.providerID }));
  if (model && !modelOptions.some((item) => item.value === modelKey(model))) {
    modelOptions.unshift({ value: modelKey(model), label: model.id, group: model.providerID });
  }
  const scene = BACKGROUNDS.find((item) => item.id === background);
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
          <h2 className="text-sm font-semibold">Settings</h2>
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
            <Field label="Message time" hint="Show the clock on messages">
              <Toggle on={showTime} onChange={onShowTime} label="Show message time" />
            </Field>
            <Field label="Desktop notifications" hint="Waiting and finished chats">
              <Toggle on={notify} onChange={() => onNotify()} label="Desktop notifications" />
            </Field>
          </Section>
        </div>
      </div>
    </div>
  );
}
