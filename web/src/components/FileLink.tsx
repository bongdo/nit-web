import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileCode2, Sparkles } from "lucide-react";
import { appLinkClick, fileLinkClick, openInApp } from "../lib/appLink";
import { annotatable, previewable, viewHref } from "../lib/fileLink";
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
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const canPreview = previewable(path);
  const href = canPreview ? viewHref(path, instance, sessionID) : pero;
  const agentHref = canPreview && annotatable(path) && sessionID ? `${href}&mode=agent` : "";
  const target = { app: "pero" as const, path, lines, agent };

  const cancelTimers = () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  const openFromLink = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 208;
    const height = agentHref ? 76 : 40;
    const left = Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8),
    );
    const above = rect.top - height - 6;
    const top = Math.max(
      8,
      Math.min(
        above >= 8 ? above : rect.bottom + 6,
        window.innerHeight - height - 8,
      ),
    );
    setMenu({ x: left, y: top });
  };

  const scheduleClose = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMenu(null);
    }, 180);
  };

  const close = () => {
    cancelTimers();
    setMenu(null);
  };

  useEffect(() => cancelTimers, []);

  useEffect(() => {
    document.addEventListener("scroll", cancelTimers, true);
    return () => document.removeEventListener("scroll", cancelTimers, true);
  }, []);

  useEffect(() => {
    if (!menu) return;
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
    close();
    window.open(agentHref, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={
          canPreview
            ? `${title} · Shift-click for pero · Hover or right-click for more`
            : `Open ${path} in pero`
        }
        className={className}
        data-file-path={path}
        data-file-lines={lines ? JSON.stringify(lines) : undefined}
        data-pero-href={pero}
        onClick={(event) => {
          event.stopPropagation();
          close();
          if (canPreview) fileLinkClick(target, pero)(event);
          else appLinkClick(target, pero)(event);
        }}
        onPointerEnter={
          canPreview
            ? (event) => {
                if (event.pointerType !== "mouse" || event.buttons !== 0) return;
                if (window.getSelection()?.toString().trim()) return;
                if (openTimer.current !== null) window.clearTimeout(openTimer.current);
                openTimer.current = window.setTimeout(() => {
                  openTimer.current = null;
                  openFromLink();
                }, 220);
                if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
              }
            : undefined
        }
        onPointerLeave={canPreview ? scheduleClose : undefined}
        onContextMenu={
          canPreview
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                cancelTimers();
                setMenu({ x: event.clientX, y: event.clientY });
              }
            : undefined
        }
      >
        {children}
      </a>
      {menu &&
        canPreview &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onPointerEnter={() => {
              if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
            }}
            onPointerLeave={scheduleClose}
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
                close();
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
