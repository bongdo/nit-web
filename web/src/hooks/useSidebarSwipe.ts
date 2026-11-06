import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceSwipe,
  horizontalScroll,
  settleSwipe,
  swipeIntent,
  SWIPE_SETTLE_MS,
} from "../lib/swipe";

export type SidebarSwipeMode = "off" | "follow" | "trigger";

function isScrollableX(target: EventTarget | null, deltaX: number): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        const room =
          deltaX > 0
            ? node.scrollLeft + node.clientWidth < node.scrollWidth - 1
            : node.scrollLeft > 0;
        if (room) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function useSidebarSwipe(mode: SidebarSwipeMode, onTrigger: (open: boolean) => void) {
  const ref = useRef<HTMLElement | null>(null);
  const [opened, setOpened] = useState(false);
  const position = useRef(0);
  const lastStep = useRef(0);
  const travel = useRef(0);
  const fired = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const trigger = useRef(onTrigger);
  trigger.current = onTrigger;

  const paint = useCallback((value: number, animate: boolean) => {
    const element = ref.current;
    if (!element) return;
    element.style.setProperty("--sidebar-swipe", String(value));
    element.toggleAttribute("data-dragging", !animate);
  }, []);

  const snap = useCallback(
    (target: number) => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
      position.current = target;
      lastStep.current = 0;
      paint(target, true);
      setOpened(target === 1);
    },
    [paint],
  );

  const open = useCallback(() => {
    if (mode === "follow") snap(1);
  }, [mode, snap]);

  const close = useCallback(() => {
    if (mode === "follow") snap(0);
  }, [mode, snap]);

  const toggle = useCallback(() => {
    if (mode === "follow") snap(position.current >= 0.5 ? 0 : 1);
  }, [mode, snap]);

  useEffect(() => {
    const element = ref.current;
    position.current = 0;
    lastStep.current = 0;
    travel.current = 0;
    fired.current = false;
    setOpened(false);
    element?.style.removeProperty("--sidebar-swipe");
    element?.removeAttribute("data-dragging");

    if (mode === "off") {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
      return;
    }

    if (mode === "follow") paint(0, true);

    const settle = () => {
      settleTimer.current = null;
      if (mode === "follow") snap(settleSwipe(position.current, lastStep.current) ? 1 : 0);
      lastStep.current = 0;
      travel.current = 0;
      fired.current = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia("(min-width: 48rem)").matches) return;
      const deltaX = horizontalScroll(event);
      if (deltaX === null || isScrollableX(event.target, deltaX)) return;
      event.preventDefault();
      if (mode === "follow") {
        const width = element?.offsetWidth || 280;
        const next = advanceSwipe(position.current, deltaX, width);
        lastStep.current = next - position.current;
        position.current = next;
        paint(next, false);
      } else if (!fired.current) {
        travel.current += deltaX;
        const intent = swipeIntent(travel.current);
        if (intent) {
          fired.current = true;
          trigger.current(intent === "open");
        }
      }
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(settle, SWIPE_SETTLE_MS);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    };
  }, [mode, paint, snap]);

  return { ref, opened, open, close, toggle };
}
