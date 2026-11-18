import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileCode2, Sparkles } from "lucide-react";
import { fileLinkClick, openInApp } from "../lib/appLink";
import { viewHref } from "../lib/fileLink";
import type { LineRange } from "../lib/types";

type FileLinkProps = {
  path: string;
  lines?: LineRange[];
  pero: string;
  agent?: string;
  instance?: string;
  sessionID?: string;
  title: string;
  className?: string;
  children: ReactNode;
};

export function FileLink({
  path,
  lines,
  pero,
  agent,
  instance,
  sessionID,
  title,
  className,
  children,
}: FileLinkProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const href = viewHref(path, instance, sessionID);
  const agentHref = sessionID ? `${href}&mode=agent` : "";
  const target = { app: "pero" as const, path, lines, agent };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const openAgent = () => {
    if (!agentHref) return;
    setMenu(null);
    window.open(agentHref, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={`${title} · Shift-click for pero · Right-click for more`}
        className={className}
        data-file-path={path}
        data-file-lines={lines ? JSON.stringify(lines) : undefined}
        data-pero-href={pero}
        onClick={(event) => {
          event.stopPropagation();
          fileLinkClick(target, pero)(event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {children}
      </a>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="overlay-popover border-border bg-popover text-popover-foreground fixed z-[100] min-w-52 rounded-lg border p-1 shadow-lg"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 216)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - (agentHref ? 84 : 44))),
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                openInApp(target, pero);
              }}
              className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]"
            >
              <FileCode2 className="text-muted-foreground size-3.5 shrink-0" />
              Open in pero
            </button>
            {agentHref && (
              <button
                type="button"
                role="menuitem"
                onClick={openAgent}
                className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]"
              >
                <Sparkles className="text-muted-foreground size-3.5 shrink-0" />
                Agent edit
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
