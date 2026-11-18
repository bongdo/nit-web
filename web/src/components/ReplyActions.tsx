import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Play, Volume2 } from "lucide-react";
import { copyText } from "../lib/clipboard";
import {
  pauseSpeech,
  readSelection,
  resumeSpeech,
  startReading,
  stopSpeech,
  useSpeech,
} from "../lib/speech";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export function ReplyActions({
  text,
  className,
  enter = false,
}: {
  text: string;
  className?: string;
  enter?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [selection, setSelection] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const speech = useSpeech();

  const messageId = (): string =>
    root.current?.closest("[data-message-id]")?.getAttribute("data-message-id") ?? "";

  const active = speech.phase !== "idle" && speech.message === messageId();
  const loading = active && speech.phase === "loading";
  const playing = active && speech.phase === "playing";
  const paused = active && speech.phase === "paused";

  const selectedText = (): string => {
    const picked = window.getSelection();
    if (!picked || picked.isCollapsed || picked.rangeCount === 0) return "";
    const container = root.current?.closest("[data-message-id]");
    if (!container || !container.contains(picked.anchorNode) || !container.contains(picked.focusNode)) {
      return "";
    }
    const value = picked.toString().trim();
    return value.length >= 3 ? value : "";
  };

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const speak = () => {
    if (active) {
      if (playing) {
        pauseSpeech();
        return;
      }
      if (paused) {
        resumeSpeech();
        return;
      }
      stopSpeech();
      return;
    }
    const picked = selectedText();
    setSelection(false);
    if (picked) readSelection(messageId(), picked);
    else startReading(messageId(), text);
  };

  return (
    <div
      ref={root}
      className={cn("flex items-center gap-1", enter && "reply-actions-enter", className)}
    >
      <Button
        variant="ghost"
        size="xs"
        className={`row-sheen-copy text-muted-foreground${copied ? " row-sheen-copy-on" : ""}`}
        onClick={() => void copy()}
        aria-label="Copy assistant reply"
      >
        {copied ? <Check /> : <Copy />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onMouseDown={(event) => {
          setSelection(Boolean(selectedText()));
          event.preventDefault();
        }}
        onTouchStart={() => setSelection(Boolean(selectedText()))}
        onClick={speak}
        aria-label={
          loading
            ? "Cancel speech preparation"
            : playing
              ? "Pause reading"
              : paused
                ? "Resume reading"
                : selection
                  ? "Read selection"
                  : "Read aloud"
        }
        title={
          loading
            ? "Cancel speech preparation"
            : playing
              ? "Pause reading"
              : paused
                ? "Resume reading"
                : selection
                  ? "Read selection"
                  : "Read aloud"
        }
      >
        {loading ? (
          <Loader2 className="animate-spin" />
        ) : playing ? (
          <span className="read-equalizer" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        ) : paused ? (
          <Play />
        ) : (
          <Volume2 />
        )}
        <span>{loading ? "Cancel" : playing ? "Pause" : paused ? "Resume" : "Read"}</span>
      </Button>
    </div>
  );
}
