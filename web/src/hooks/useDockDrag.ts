import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DOCK_MOVE_PX, dockOpens, dockProgress } from "../lib/dock";

function swallowClick() {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", stop, true);
  window.setTimeout(() => window.removeEventListener("click", stop, true), 350);
}

export function useDockDrag({
  open,
  height,
  onOpen,
  onClose,
}: {
  open: boolean;
  height: () => number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const drag = useRef<{
    id: number;
    y: number;
    from: number;
    height: number;
    moved: boolean;
    last: number;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const from = open ? 1 : 0;
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      from,
      height: height(),
      moved: false,
      last: from,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setProgress(from);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    if (!state.moved && Math.abs(event.clientY - state.y) < DOCK_MOVE_PX) return;
    state.moved = true;
    state.last = dockProgress(state.from, event.clientY - state.y, state.height);
    setProgress(state.last);
  };

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    setProgress(null);
    swallowClick();
    if (!state.moved) {
      if (open) onClose();
      else onOpen();
      return;
    }
    if (dockOpens(state.last)) onOpen();
    else onClose();
  };

  const cancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    drag.current = null;
    setProgress(null);
  };

  return {
    progress,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: cancel,
    },
  };
}
