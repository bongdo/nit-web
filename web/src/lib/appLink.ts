import type { MouseEvent } from "react";
import type { LineRange } from "./types";

export type AppTarget =
  | { app: "pero"; path: string; lines?: LineRange[]; agent?: string }
  | { app: "term"; dir?: string; session?: string };

const FALLBACK_MS = 400;

export function openInApp(target: AppTarget, href: string): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  const channel = new BroadcastChannel(`nit-${target.app}`);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let done = false;
  const settle = () => {
    done = true;
    channel.close();
  };
  const timer = window.setTimeout(() => {
    if (done) return;
    settle();
    window.open(href, "_blank", "noopener,noreferrer");
  }, FALLBACK_MS);
  channel.onmessage = (event: MessageEvent<{ type?: string; id?: string }>) => {
    if (done) return;
    const data = event.data;
    if (data?.type === "ack" && data.id === id) {
      window.clearTimeout(timer);
      settle();
    }
  };
  channel.postMessage({ type: "open", id, ...target });
}

export function fileLinkClick(target: AppTarget, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    openInApp(target, href);
  };
}

export function appLinkClick(target: AppTarget, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    openInApp(target, href);
  };
}
