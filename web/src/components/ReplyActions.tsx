import { useEffect, useRef, useState } from "react";
import { Check, Copy, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
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
  const [speaking, setSpeaking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const speechTimer = useRef<number | null>(null);
  const owner = useRef(Symbol("reply"));
  const generation = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    const onSpeak = (event: Event) => {
      if ((event as CustomEvent).detail !== owner.current) {
        generation.current += 1;
        setSpeaking(false);
      }
    };
    window.addEventListener("nit-gui:speech", onSpeak);
    return () => {
      window.removeEventListener("nit-gui:speech", onSpeak);
      generation.current += 1;
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const stop = () => {
    void api.ttsStop().catch(() => {});
    if (supported) window.speechSynthesis.cancel();
    if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
    speechTimer.current = null;
    setSpeaking(false);
  };

  const speakBrowser = (): void => {
    if (!supported) {
      setUnavailable(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[А-Яа-яЁё]/.test(text) ? "ru-RU" : "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const speak = async (): Promise<void> => {
    if (speaking) {
      stop();
      return;
    }
    const gen = ++generation.current;
    window.dispatchEvent(new CustomEvent("nit-gui:speech", { detail: owner.current }));
    try {
      await api.tts(text);
      if (gen !== generation.current) return;
      if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
      speechTimer.current = window.setTimeout(
        () => setSpeaking(false),
        Math.min(180_000, Math.max(4_000, text.length * 55)),
      );
      setSpeaking(true);
    } catch {
      if (gen !== generation.current) return;
      speakBrowser();
    }
  };

  return (
    <div className={cn("flex items-center gap-1", enter && "reply-actions-enter", className)}>
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
      {!unavailable && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => void speak()}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
          title={speaking ? "Stop reading" : "Read aloud"}
        >
          {speaking ? (
            <span className="read-equalizer" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <Volume2 />
          )}
          <span>{speaking ? "Stop" : "Read"}</span>
        </Button>
      )}
    </div>
  );
}
