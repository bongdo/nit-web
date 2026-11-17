import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModals = 0;

export function Modal({
  label,
  title,
  actions,
  onClose,
  onEscape,
  closeLabel = "Close",
  closeSize = "icon-sm",
  className,
  panelClassName,
  children,
}: {
  label: string;
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  onEscape?: () => void;
  closeLabel?: string;
  closeSize?: "icon-sm" | "icon-xs";
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const escape = useRef(onEscape ?? onClose);
  escape.current = onEscape ?? onClose;

  useEffect(() => {
    const root = document.getElementById("root");
    const previous = document.activeElement;
    if (root && openModals++ === 0) root.setAttribute("inert", "");
    const node = panel.current;
    node?.focus();
    return () => {
      if (root && --openModals === 0) root.removeAttribute("inert");
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        escape.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.getClientRects().length > 0,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <div
      className={cn(
        "overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",
        className,
      )}
      onPointerDown={(event) => {
        pressed.current = event.target === event.currentTarget;
      }}
      onClick={() => {
        if (pressed.current) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border shadow-xl outline-none",
          panelClassName,
        )}
      >
        <div className="border-border flex items-center gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
          {actions}
          <Button variant="ghost" size={closeSize} onClick={onClose} aria-label={closeLabel}>
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
