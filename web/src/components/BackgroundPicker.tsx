import { useState } from "react";
import { Check, Shuffle, X } from "lucide-react";
import { BACKGROUNDS } from "../lib/backgrounds";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";
import { Scene, type SceneSetting } from "./Scene";

export function BackgroundPicker({
  background,
  onPick,
  onClose,
}: {
  background: SceneSetting;
  onPick: (background: SceneSetting) => void;
  onClose: () => void;
}) {
  const panel = useModalFocus<HTMLDivElement>();
  const [hovered, setHovered] = useState<SceneSetting | null>(null);

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Background"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Background</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close backgrounds">
            <X />
          </Button>
        </div>

        <div className="scrollbar-thin grid grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
          {BACKGROUNDS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.id)}
              onPointerEnter={() => setHovered(item.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(item.id)}
              onBlur={() => setHovered(null)}
              aria-pressed={background === item.id}
              className={cn(
                "bg-card text-foreground border-border hover:border-ring/60 relative rounded-lg border p-1.5 text-left transition-colors",
                background === item.id && "ring-ring ring-2",
              )}
            >
              <span className="border-border bg-background relative block aspect-[16/10] overflow-hidden rounded-md border">
                {item.id === "random" ? (
                  <span className="text-muted-foreground from-primary/25 via-spark/15 to-success/25 grid size-full place-items-center bg-linear-to-br">
                    <Shuffle className="size-6" />
                  </span>
                ) : (
                  <Scene
                    variant={item.id}
                    motion={hovered === item.id ? "animated" : "static"}
                    preview
                    className="[mask-image:none]"
                  />
                )}
              </span>
              <span className="mt-1.5 flex items-baseline justify-between gap-1 px-0.5">
                <span className="truncate text-xs font-medium">{item.label}</span>
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  {item.hint}
                </span>
              </span>
              {background === item.id && (
                <span className="bg-primary text-primary-foreground absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full">
                  <Check className="size-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
