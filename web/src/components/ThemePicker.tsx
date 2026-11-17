import { Check } from "lucide-react";
import { THEMES, type Theme } from "../lib/themes";
import { cn } from "../lib/utils";
import { Modal } from "./ui/Modal";

export function ThemePicker({
  theme,
  onPick,
  onClose,
}: {
  theme: Theme;
  onPick: (theme: Theme) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      label="Theme"
      closeLabel="Close themes"
      title={<h2 className="text-sm font-semibold">Theme</h2>}
      onClose={onClose}
      panelClassName="max-w-md"
    >
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
    </Modal>
  );
}
