import { useEffect, useRef, useState } from "react";
import { Check, Copy, Volume2, VolumeX } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export function ReplyActions({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<number | null>(null);
  const owner = useRef(Symbol("reply"));
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    const onSpeak = (event: Event) => {
      if ((event as CustomEvent).detail !== owner.current) setSpeaking(false);
    };
    window.addEventListener("nit-gui:speech", onSpeak);
    return () => {
      window.removeEventListener("nit-gui:speech", onSpeak);
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const speak = () => {
    if (!supported) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    window.dispatchEvent(new CustomEvent("nit-gui:speech", { detail: owner.current }));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[А-Яа-яЁё]/.test(text) ? "ru-RU" : "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
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
      {supported && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={speak}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
          title={speaking ? "Stop reading" : "Read aloud"}
        >
          {speaking ? <VolumeX /> : <Volume2 />}
          <span>{speaking ? "Stop" : "Read"}</span>
        </Button>
      )}
    </div>
  );
}
