import { useCallback, useEffect, useRef, useState } from "react";
import { advanceSwipe, horizontalScroll, settleSwipe, SWIPE_SETTLE_MS } from "../lib/swipe";

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

export function useSidebarSwipe(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const position = useRef(0);
  const lastStep = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const [opened, setOpened] = useState(false);

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
    if (enabled) snap(1);
  }, [enabled, snap]);

  const close = useCallback(() => {
    if (enabled) snap(0);
  }, [enabled, snap]);

  const toggle = useCallback(() => {
    if (enabled) snap(position.current >= 0.5 ? 0 : 1);
  }, [enabled, snap]);

  useEffect(() => {
    const element = ref.current;
    if (!enabled) {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
      position.current = 0;
      lastStep.current = 0;
      setOpened(false);
      element?.style.removeProperty("--sidebar-swipe");
      element?.removeAttribute("data-dragging");
      return;
    }

    paint(position.current, true);

    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia("(min-width: 48rem)").matches) return;
      const deltaX = horizontalScroll(event);
      if (deltaX === null || isScrollableX(event.target, deltaX)) return;
      event.preventDefault();
      const width = element?.offsetWidth || 280;
      const next = advanceSwipe(position.current, deltaX, width);
      lastStep.current = next - position.current;
      position.current = next;
      paint(next, false);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        snap(settleSwipe(position.current, lastStep.current) ? 1 : 0);
      }, SWIPE_SETTLE_MS);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    };
  }, [enabled, paint, snap]);

  return { ref, opened, open, close, toggle };
}
