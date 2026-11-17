import { Fragment, useState } from "react";
import { Check, Shuffle } from "lucide-react";
import { BACKGROUNDS, BACKGROUND_GROUPS } from "../lib/backgrounds";
import { isGpuVariant } from "../lib/gpu-ids";
import { cn } from "../lib/utils";
import { Modal } from "./ui/Modal";
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
  const [hovered, setHovered] = useState<SceneSetting | null>(null);

  return (
    <Modal
      label="Background"
      closeLabel="Close backgrounds"
      title={<h2 className="text-sm font-semibold">Background</h2>}
      onClose={onClose}
      panelClassName="max-w-2xl"
    >
      <div className="scrollbar-thin grid grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
          {BACKGROUNDS.map((item, index) => (
            <Fragment key={item.id}>
              {(index === 0 || BACKGROUNDS[index - 1].group !== item.group) && (
                <p className="text-muted-foreground col-span-full mt-1 text-[10px] font-medium uppercase tracking-widest first:mt-0">
                  {BACKGROUND_GROUPS[item.group] ?? item.group}
                </p>
              )}
            <button
              type="button"
              onClick={() => {
                onPick(item.id);
                onClose();
              }}
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
                ) : isGpuVariant(item.id) && hovered !== item.id && background !== item.id ? (
                  <span className="text-muted-foreground/70 from-card via-card to-secondary grid size-full place-items-center bg-linear-to-br text-[10px] font-medium uppercase tracking-widest">
                    gpu
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
        </Fragment>
      ))}
      </div>
    </Modal>
  );
}
