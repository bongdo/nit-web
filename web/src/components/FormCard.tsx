import { useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import type { FormField, FormInfo } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function initialValues(form: FormInfo): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.default !== undefined) values[field.key] = field.default;
    else if (field.type === "boolean") values[field.key] = false;
    else if (field.type === "multiselect") values[field.key] = [];
    else values[field.key] = "";
  }
  return values;
}

function isVisible(field: FormField, values: Record<string, unknown>): boolean {
  if (field.hidden) return false;
  if (!field.when || field.when.length === 0) return true;
  return field.when.every((condition) => {
    const value = values[condition.key];
    return condition.op === "eq" ? value === condition.value : value !== condition.value;
  });
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function FormCard({
  form,
  sessionID,
  onDone,
  onError,
}: {
  form: FormInfo;
  sessionID: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(form));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const answer: Record<string, unknown> = {};
    for (const field of form.fields) {
      if (!isVisible(field, values)) continue;
      const value = values[field.key];
      if (field.required && isEmpty(value)) {
        setError(`${field.title ?? field.key} is required.`);
        return;
      }
      if (isEmpty(value)) continue;
      if (field.type === "number" || field.type === "integer") {
        answer[field.key] = field.type === "integer" ? Math.trunc(Number(value)) : Number(value);
      } else if (field.type === "boolean") {
        answer[field.key] = Boolean(value);
      } else if (field.type === "multiselect") {
        answer[field.key] = value;
      } else {
        answer[field.key] = String(value);
      }
    }
    setBusy(true);
    setError(null);
    try {
      await api.replyForm(sessionID, form.id, answer);
      onDone();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not submit the form.";
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelForm(sessionID, form.id, "Cancelled in nit-gui");
      onDone();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not cancel the form.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-form-card
      className="border-primary/30 bg-card mx-auto my-2 w-full max-w-3xl rounded-xl border p-3 shadow-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{form.title}</div>
          <div className="text-muted-foreground truncate text-[10px]">
            {open
              ? form.metadata?.kind === "question"
                ? "The agent is waiting for your answer."
                : "The agent needs input."
              : "Collapsed · click to open"}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      <div className={cn("mt-2 space-y-3", !open && "hidden")}>
        {form.fields.filter((field) => isVisible(field, values)).map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="text-[12px] font-medium">
              {field.title ?? field.key}
              {field.required && <span className="text-destructive"> *</span>}
            </div>
            {field.description && (
              <p className="text-muted-foreground text-[11px] leading-4">{field.description}</p>
            )}

            {field.type === "boolean" ? (
              <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(event) => set(field.key, event.target.checked)}
                  className="accent-primary size-3.5"
                />
                Yes
              </label>
            ) : field.type === "multiselect" ? (
              <div className="space-y-1">
                {(field.options ?? []).map((option) => {
                  const current = Array.isArray(values[field.key])
                    ? (values[field.key] as string[])
                    : [];
                  const checked = current.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          set(
                            field.key,
                            checked
                              ? current.filter((item) => item !== option.value)
                              : [...current, option.value],
                          )
                        }
                        className="accent-primary mt-0.5 size-3.5"
                      />
                      <span className="min-w-0">
                        <span className="block">{option.label}</span>
                        {option.description && (
                          <span className="text-muted-foreground block text-[10px]">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : field.type === "number" || field.type === "integer" ? (
              <Input
                type="number"
                value={String(values[field.key] ?? "")}
                onChange={(event) => set(field.key, event.target.value)}
                className="h-8 text-xs"
              />
            ) : field.type === "external" ? (
              <a
                href={field.url ?? "#"}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary text-[11px] underline"
              >
                Open
              </a>
            ) : (field.options?.length ?? 0) > 0 ? (
              <div className="space-y-1">
                {field.options?.map((option) => {
                  const current = String(values[field.key] ?? "");
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px]",
                        current === option.value && "bg-accent/50",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${form.id}-${field.key}`}
                        checked={current === option.value}
                        onChange={() => set(field.key, option.value)}
                        className="accent-primary mt-0.5 size-3.5"
                      />
                      <span className="min-w-0">
                        <span className="block">{option.label}</span>
                        {option.description && (
                          <span className="text-muted-foreground block text-[10px]">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
                {field.custom && (
                  <Input
                    value={
                      field.options?.some((option) => option.value === values[field.key])
                        ? ""
                        : String(values[field.key] ?? "")
                    }
                    onChange={(event) => set(field.key, event.target.value)}
                    placeholder="Or type your own answer…"
                    className="h-8 text-xs"
                  />
                )}
              </div>
            ) : (
              <Input
                value={String(values[field.key] ?? "")}
                onChange={(event) => set(field.key, event.target.value)}
                placeholder={field.placeholder ?? "Your answer"}
                className="h-8 text-xs"
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-destructive mt-2 text-[11px]">{error}</p>}

      {open && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => void cancel()} disabled={busy}>
            <X />
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Answer
          </Button>
        </div>
      )}
    </div>
  );
}
