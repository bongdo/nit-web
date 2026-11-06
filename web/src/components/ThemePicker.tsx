import { Check, X } from "lucide-react";
import { THEMES, type Theme } from "../lib/themes";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";

export function ThemePicker({
  theme,
  onPick,
  onClose,
}: {
  theme: Theme;
  onPick: (theme: Theme) => void;
  onClose: () => void;
}) {
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
        aria-label="Theme"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Theme</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close themes">
            <X />
          </Button>
        </div>

        <div className="scrollbar-thin grid gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              data-theme={item.id === "system" ? undefined : item.id}
              onClick={() => onPick(item.id)}
              aria-pressed={theme === item.id}
              className={cn(
                "bg-card text-foreground border-border hover:border-ring/60 flex items-center gap-3 rounded-lg border p-2 text-left transition-colors",
                theme === item.id && "ring-ring ring-2",
              )}
            >
              <span className="border-border bg-background flex size-9 shrink-0 items-center justify-center rounded-md border text-xs font-semibold">
                Aa
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{item.label}</span>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">
                  {item.hint}
                </span>
              </span>
              <span className="flex shrink-0 gap-1" aria-hidden>
                <span className="bg-primary size-2 rounded-full" />
                <span className="bg-spark size-2 rounded-full" />
                <span className="bg-success size-2 rounded-full" />
              </span>
              {theme === item.id && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
