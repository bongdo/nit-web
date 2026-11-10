import { useEffect, useRef } from "react";
import { horizontalScroll, swipeIntent, SWIPE_SETTLE_MS } from "../lib/swipe";

const EDGE_PX = 24;
const AXIS_PX = 8;

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

export function useSidebarSwipe(onTrigger: (open: boolean) => void) {
  const ref = useRef<HTMLElement | null>(null);
  const travel = useRef(0);
  const fired = useRef(false);
  const timer = useRef<number | null>(null);
  const trigger = useRef(onTrigger);
  trigger.current = onTrigger;

  useEffect(() => {
    const element = ref.current;
    travel.current = 0;
    fired.current = false;

    const settle = () => {
      timer.current = null;
      travel.current = 0;
      fired.current = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia("(min-width: 48rem)").matches) return;
      const deltaX = horizontalScroll(event);
      if (deltaX === null || isScrollableX(event.target, deltaX)) return;
      event.preventDefault();
      if (!fired.current) {
        travel.current += deltaX;
        const intent = swipeIntent(travel.current);
        if (intent) {
          fired.current = true;
          trigger.current(intent === "open");
        }
      }
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(settle, SWIPE_SETTLE_MS);
    };

    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    let suppressTimer = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      if (!window.matchMedia("(min-width: 48rem)").matches) return;
      const inside = Boolean(element && element.contains(event.target as Node));
      if (!inside && event.clientX > EDGE_PX) return;
      travel.current = 0;
      fired.current = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          drag = null;
          return;
        }
        drag.moved = true;
      }
      if (fired.current) return;
      event.preventDefault();
      const intent = swipeIntent(-dx);
      if (!intent) return;
      fired.current = true;
      trigger.current(intent === "open");
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      travel.current = 0;
      fired.current = false;
      if (!moved) return;
      suppressClick = true;
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 350);
    };

    const onPointerCancel = () => {
      drag = null;
      travel.current = 0;
      fired.current = false;
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(suppressTimer);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  return { ref };
}
