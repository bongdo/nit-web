import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DOCK_MOVE_PX, dockProgress, dockSettlesOpen } from "../lib/dock";

const FLING_WINDOW_MS = 120;

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
    samples: { t: number; y: number }[];
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
      samples: [{ t: event.timeStamp, y: event.clientY }],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setProgress(from);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    state.samples.push({ t: event.timeStamp, y: event.clientY });
    if (state.samples.length > 16) state.samples.shift();
    if (!state.moved) {
      if (Math.abs(event.clientY - state.y) < DOCK_MOVE_PX) return;
      state.moved = true;
    }
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
    const recent = state.samples.filter(
      (sample) => event.timeStamp - sample.t <= FLING_WINDOW_MS,
    );
    const first = recent[0];
    const last = recent[recent.length - 1];
    let velocity = 0;
    if (first && last && last.t > first.t) {
      velocity = (-(last.y - first.y) / (last.t - first.t)) * (1000 / Math.max(1, state.height));
    }
    const travel = state.y - event.clientY;
    if (dockSettlesOpen(state.last, velocity, travel)) onOpen();
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
