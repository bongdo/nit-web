import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DOCK_MOVE_PX, DOCK_SETTLE, dockProgress, dockSettlesOpen } from "../lib/dock";

const FLING_WINDOW_MS = 120;

function swallowClick() {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", stop, true);
  window.setTimeout(() => window.removeEventListener("click", stop, true), 350);
}

export type DockPull = {
  begin: (y: number, time: number) => void;
  move: (y: number, time: number) => void;
  end: (y: number, time: number, settle?: number) => void;
  cancel: () => void;
};

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
  const live = useRef({ open, height, onOpen, onClose });
  live.current = { open, height, onOpen, onClose };

  const begin = useCallback((y: number, time: number, id = -1) => {
    const now = live.current;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const from = now.open ? 1 : 0;
    drag.current = {
      id,
      y,
      from,
      height: now.height(),
      moved: false,
      last: from,
      samples: [{ t: time, y }],
    };
    setProgress(from);
  }, []);

  const move = useCallback((y: number, time: number) => {
    const state = drag.current;
    if (!state) return;
    state.samples.push({ t: time, y });
    if (state.samples.length > 16) state.samples.shift();
    if (!state.moved) {
      if (Math.abs(y - state.y) < DOCK_MOVE_PX) return;
      state.moved = true;
    }
    state.last = dockProgress(state.from, y - state.y, state.height);
    setProgress(state.last);
  }, []);

  const end = useCallback((y: number, time: number, settle = DOCK_SETTLE) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setProgress(null);
    swallowClick();
    if (!state.moved) {
      if (state.from === 1) live.current.onClose();
      else live.current.onOpen();
      return;
    }
    const recent = state.samples.filter((sample) => time - sample.t <= FLING_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    let velocity = 0;
    if (first && last && last.t > first.t) {
      velocity = (-(last.y - first.y) / (last.t - first.t)) * (1000 / Math.max(1, state.height));
    }
    const travel = state.y - y;
    if (dockSettlesOpen(state.last, velocity, travel, settle)) live.current.onOpen();
    else live.current.onClose();
  }, []);

  const cancel = useCallback(() => {
    drag.current = null;
    setProgress(null);
  }, []);

  const handlers = useMemo(
    () => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        begin(event.clientY, event.timeStamp, event.pointerId);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        if (drag.current?.id !== event.pointerId) return;
        move(event.clientY, event.timeStamp);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        if (drag.current?.id !== event.pointerId) return;
        end(event.clientY, event.timeStamp);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
        if (drag.current?.id !== event.pointerId) return;
        cancel();
      },
    }),
    [begin, move, end, cancel],
  );

  const pull = useMemo<DockPull>(
    () => ({
      begin: (y, time) => begin(y, time),
      move,
      end,
      cancel,
    }),
    [begin, move, end, cancel],
  );

  return { progress, handlers, pull };
}
