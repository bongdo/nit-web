import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, FileCode2, Quote, Volume2 } from "lucide-react";
import { openInApp } from "../lib/appLink";
import { copyText } from "../lib/clipboard";
import { tap, tick } from "../lib/haptics";
import { nativeAndroid } from "../lib/native";
import {
  boxesOf,
  caretAt,
  rangeBetween,
  selectionFile,
  wordAt,
  type Box,
  type Point,
} from "../lib/selection";
import { readFromSelection } from "../lib/speech";
import { Button } from "./ui/button";

type Mark = {
  range: Range;
  boxes: Box[];
  text: string;
};

type Picker = {
  left: number;
  top: number;
  above: boolean;
};

const LONG_PRESS_MS = 380;
const DRIFT_PX = 12;
const SKIP = "button, a, input, textarea, select, summary, [role='button']";

function targetMeta(range: Range) {
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return {
    messageID: element?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? "",
    block: Number(element?.closest("[data-speech-block]")?.getAttribute("data-speech-block") ?? -1),
    file: selectionFile(node),
  };
}

export function TextSelectionMenu({
  container,
  onQuote,
}: {
  container: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const enabled = useMemo(
    () => nativeAndroid() || /[?&]touchselect=1/.test(window.location.search),
    [],
  );
  const [mark, setMark] = useState<Mark | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const from = useRef<Point | null>(null);
  const to = useRef<Point | null>(null);
  const edge = useRef<"start" | "end" | null>(null);
  const lastText = useRef("");
  const current = useRef<Mark | null>(null);
  current.current = mark;

  const clear = useCallback(() => {
    from.current = null;
    to.current = null;
    edge.current = null;
    lastText.current = "";
    setMark(null);
    setPicker(null);
    setCopied(false);
  }, []);

  const apply = useCallback(() => {
    const a = from.current;
    const b = to.current;
    if (!a || !b) return;
    const range = rangeBetween(a, b);
    if (!range) return;
    const text = range.toString();
    const boxes = boxesOf(range);
    if (!text.trim() || boxes.length === 0) return;
    from.current = { node: range.startContainer, offset: range.startOffset };
    to.current = { node: range.endContainer, offset: range.endOffset };
    if (text !== lastText.current) {
      lastText.current = text;
      tick();
    }
    setMark({ range, boxes, text });
  }, []);

  useEffect(() => {
    const root = container.current;
    if (!enabled || !root) return;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let pressing = false;

    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };

    const onStart = (event: TouchEvent) => {
      stop();
      pressing = false;
      if (event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (target?.closest(SKIP)) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        timer = 0;
        const word = wordAt(startX, startY);
        if (!word) return;
        pressing = true;
        from.current = word.from;
        to.current = word.to;
        lastText.current = word.range.toString();
        setCopied(false);
        setMark({ range: word.range, boxes: boxesOf(word.range), text: lastText.current });
        tap();
      }, LONG_PRESS_MS);
    };

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        stop();
        return;
      }
      const touch = event.touches[0];
      if (!pressing) {
        if (timer && Math.hypot(touch.clientX - startX, touch.clientY - startY) > DRIFT_PX) stop();
        return;
      }
      event.preventDefault();
      const point = caretAt(touch.clientX, touch.clientY);
      if (!point) return;
      to.current = point;
      apply();
    };

    const onEnd = () => {
      stop();
      pressing = false;
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      stop();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, [apply, container, enabled]);

  const active = mark !== null;
  useEffect(() => {
    if (!active) return;
    const away = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-selection-ui]")) return;
      clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    const viewport = window.visualViewport;
    const resize = () => clear();
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const range = current.current?.range;
        const boxes = range ? boxesOf(range) : [];
        if (!range || boxes.length === 0) {
          clear();
          return;
        }
        setMark((value) => (value ? { ...value, boxes } : value));
      });
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    container.current?.addEventListener("scroll", scroll, { passive: true });
    viewport?.addEventListener("resize", resize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
      container.current?.removeEventListener("scroll", scroll);
      viewport?.removeEventListener("resize", resize);
    };
  }, [active, clear, container]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !mark) {
      setPicker(null);
      return;
    }
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const viewport = window.visualViewport;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const offsetTop = viewport?.offsetTop ?? 0;
    const first = mark.boxes[0];
    const last = mark.boxes[mark.boxes.length - 1];
    const above = first.top - offsetTop > height + 20;
    const left = Math.min(
      Math.max(first.left + first.width / 2, offsetLeft + width / 2 + 8),
      offsetLeft + viewWidth - width / 2 - 8,
    );
    const top = above ? first.top - 10 : last.top + last.height + 10;
    setPicker({ left, top, above });
  }, [mark]);

  const copy = useCallback(() => {
    const text = mark?.text ?? "";
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      tap("medium");
      window.setTimeout(() => clear(), 900);
    });
  }, [clear, mark]);

  const grab = (which: "start" | "end") => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    edge.current = which;
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!edge.current) return;
    event.preventDefault();
    const point = caretAt(event.clientX, event.clientY);
    if (!point) return;
    if (edge.current === "end") to.current = point;
    else from.current = point;
    apply();
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    edge.current = null;
  };

  if (!enabled || !mark || typeof document === "undefined") return null;

  const meta = targetMeta(mark.range);
  const first = mark.boxes[0];
  const last = mark.boxes[mark.boxes.length - 1];

  return createPortal(
    <>
      {mark.boxes.map((box, index) => (
        <div
          key={index}
          data-selection-ui="1"
          className="sel-box"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      ))}
      <div
        data-selection-ui="1"
        className="sel-handle"
        style={{ left: first.left, top: first.top + first.height }}
        onPointerDown={grab("start")}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      />
      <div
        data-selection-ui="1"
        className="sel-handle"
        style={{ left: last.left + last.width, top: last.top + last.height }}
        onPointerDown={grab("end")}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      />
      <div
        ref={panel}
        data-selection-ui="1"
        className="fixed z-[61] flex items-center gap-1"
        style={{
          left: picker?.left ?? -9999,
          top: picker?.top ?? 0,
          transform: `translate(-50%, ${picker?.above ? "-100%" : "0"})`,
        }}
        onPointerDown={(event) => event.preventDefault()}
      >
        <Button
          variant="secondary"
          size="xs"
          className="shadow-md"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy selection"}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className="shadow-md"
          onClick={() => {
            onQuote(mark.text.trim());
            tap();
            clear();
          }}
          aria-label="Quote selection"
          title="Quote in the composer"
        >
          <Quote />
          Quote
        </Button>
        {meta.messageID && (
          <Button
            variant="secondary"
            size="xs"
            className="shadow-md"
            onClick={() => {
              readFromSelection(meta.messageID, mark.text, meta.block);
              tap();
              clear();
            }}
            aria-label="Read from here"
            title="Read from here to the end"
          >
            <Volume2 />
            Read
          </Button>
        )}
        {meta.file && (
          <Button
            variant="secondary"
            size="xs"
            className="shadow-md"
            onClick={() => {
              const file = meta.file!;
              openInApp({ app: "pero", path: file.path, lines: file.lines }, file.href);
              clear();
            }}
            aria-label={`Open ${meta.file.path} in pero`}
            title={`Open ${meta.file.path} in pero`}
          >
            <FileCode2 />
            pero
          </Button>
        )}
      </div>
    </>,
    document.body,
  );
}
