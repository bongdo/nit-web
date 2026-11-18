import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileCode2, Sparkles } from "lucide-react";
import { appLinkClick, fileLinkClick, openInApp } from "../lib/appLink";
import { annotatable, previewable, viewHref } from "../lib/fileLink";
import type { LineRange } from "../lib/types";
import { Button } from "./ui/button";

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
  const menuWidth = agentHref ? 142 : 72;
  const menuHeight = 36;

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
    const left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - menuWidth / 2,
        window.innerWidth - menuWidth - 8,
      ),
    );
    const above = rect.top - menuHeight - 6;
    const top = Math.max(
      8,
      Math.min(
        above >= 8 ? above : rect.bottom + 6,
        window.innerHeight - menuHeight - 8,
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
            role="group"
            aria-label="File actions"
            onPointerEnter={() => {
              if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
            }}
            onPointerLeave={scheduleClose}
            className="fixed z-[100] flex items-center gap-1"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - menuHeight - 8)),
            }}
          >
            <Button
              variant="secondary"
              size="xs"
              className="shadow-md"
              aria-label={`Open ${path} in pero`}
              title={`Open ${path} in pero`}
              onClick={() => {
                close();
                openInApp(target, pero);
              }}
            >
              <FileCode2 />
              pero
            </Button>
            {agentHref && (
              <Button
                variant="secondary"
                size="xs"
                className="shadow-md"
                aria-label={`Edit ${path} with the agent`}
                title={`Edit ${path} with the agent`}
                onClick={openAgent}
              >
                <Sparkles />
                agent
              </Button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
