import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import type { FormField, FormInfo } from "../lib/types";
import { api } from "../lib/api";
import {
  initialFormValues,
  isEmptyAnswer,
  isFieldVisible,
  visibleFormFields,
} from "../lib/forms";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialFormValues(form),
  );
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const done = doneFor === form.id;
  const question = form.metadata?.kind === "question";
  const visible = visibleFormFields(form, values);
  const stepped = question && visible.length > 1;
  const current = Math.min(step, Math.max(0, visible.length - 1));
  const shown = stepped ? visible.slice(current, current + 1) : visible;

  useEffect(() => {
    if (step > current) setStep(current);
  }, [current, step]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(onDone, 550);
    return () => window.clearTimeout(timer);
  }, [done, onDone]);

  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));

  const fieldError = (field: FormField): string | null =>
    field.required && isEmptyAnswer(values[field.key])
      ? `${field.title ?? field.key} is required.`
      : null;

  const next = () => {
    const problem = fieldError(visible[current]);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep(current + 1);
  };

  const submit = async () => {
    const answer: Record<string, unknown> = {};
    for (const field of form.fields) {
      if (!isFieldVisible(field, values)) continue;
      const value = values[field.key];
      const problem = fieldError(field);
      if (problem) {
        setError(problem);
        return;
      }
      if (isEmptyAnswer(value)) continue;
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
      setDoneFor(form.id);
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
      className={cn(
        "form-sheen-card border-primary/30 bg-card mx-auto my-2 w-full max-w-3xl rounded-xl border p-3 shadow-sm",
        done ? "form-sheen-done" : "form-sheen-waiting",
      )}
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
              ? stepped
                ? `Question ${current + 1} of ${visible.length} · The agent is waiting for your answer.`
                : form.metadata?.kind === "question"
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
        {stepped && (
          <div className="text-muted-foreground text-[11px] font-medium">
            {current + 1}/{visible.length}
          </div>
        )}
        {shown.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="text-[12px] font-medium">
              {field.title ?? field.key}
              {field.required && <span className="text-destructive"> *</span>}
            </div>
            {field.description && (
              <p className="text-muted-foreground text-[11px] leading-4">{field.description}</p>
            )}

            {field.type === "boolean" ? (
              <label className="form-sheen-option flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px]">
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
                      className="form-sheen-option hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px]"
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
                        "form-sheen-option hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px]",
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
          <Button variant="ghost" size="sm" onClick={() => void cancel()} disabled={busy || done}>
            <X />
            Cancel
          </Button>
          {stepped && current > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setError(null);
                setStep(current - 1);
              }}
              disabled={busy || done}
            >
              Back
            </Button>
          )}
          {stepped && current < visible.length - 1 ? (
            <Button size="sm" onClick={next} disabled={busy || done}>
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={() => void submit()} disabled={busy || done}>
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check className={done ? "form-sheen-check" : undefined} />
              )}
              Answer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
