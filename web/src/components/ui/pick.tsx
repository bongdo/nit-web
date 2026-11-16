import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export type PickOption = { value: string; label: string; hint?: string; group?: string };

export function Pick({
  value,
  options,
  placeholder,
  label,
  width,
  onChange,
}: {
  value: string;
  options: PickOption[];
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
                <div key={item.value || item.label}>
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
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Field({
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
