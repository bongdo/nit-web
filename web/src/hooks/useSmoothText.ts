import { useEffect, useRef, useState } from "react";
import { REVEAL_FRAME_MS, revealChar, revealWords } from "../lib/streamText";

export function useSmoothText(text: string, live: boolean): string {
  const [shown, setShown] = useState(text);
  const target = useRef(text);
  const current = useRef(text);
  const running = useRef(live);
  const frame = useRef<number | null>(null);
  const lastAt = useRef(0);
  const stalledAt = useRef(0);
  const fallback = useRef(false);

  const stop = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };

  const settle = () => {
    stop();
    stalledAt.current = 0;
    fallback.current = false;
    current.current = target.current;
    setShown(target.current);
  };

  const step = (now: number) => {
    frame.current = null;
    if (!running.current) {
      settle();
      return;
    }
    if (now - lastAt.current < REVEAL_FRAME_MS) {
      frame.current = requestAnimationFrame(step);
      return;
    }
    lastAt.current = now;
    let next = revealWords(target.current, current.current.length);
    if (next === current.current.length && current.current.length < target.current.length) {
      if (fallback.current) {
        next = revealChar(target.current, current.current.length);
      } else if (stalledAt.current === 0) {
        stalledAt.current = now;
      } else if (now - stalledAt.current > 250) {
        fallback.current = true;
        next = revealChar(target.current, current.current.length);
      }
    } else {
      stalledAt.current = 0;
      fallback.current = false;
    }
    if (next !== current.current.length) {
      current.current = target.current.slice(0, next);
      setShown(current.current);
    }
    if (current.current.length < target.current.length) {
      frame.current = requestAnimationFrame(step);
    }
  };

  useEffect(() => {
    target.current = text;
    running.current = live;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!live || reduced || !text.startsWith(current.current)) {
      settle();
      return;
    }
    if (frame.current === null && current.current.length < text.length) {
      frame.current = requestAnimationFrame(step);
    }
  }, [live, text]);

  useEffect(() => stop, []);

  return shown;
}
