import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { speakHost, type SpeechHandle } from "../lib/speech";
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
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [selection, setSelection] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const speechTimer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const owner = useRef(Symbol("reply"));
  const generation = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const releaseAudio = () => {
    const player = audio.current;
    audio.current = null;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
    }
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = null;
    }
  };

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
    const onSpeak = (event: Event) => {
      if ((event as CustomEvent).detail !== owner.current) {
        generation.current += 1;
        abort.current?.abort();
        abort.current = null;
        speech.current?.stop();
        speech.current = null;
        releaseAudio();
        if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
        setSpeaking(false);
        setLoading(false);
      }
    };
    window.addEventListener("nit-gui:speech", onSpeak);
    return () => {
      window.removeEventListener("nit-gui:speech", onSpeak);
      generation.current += 1;
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
      abort.current?.abort();
      abort.current = null;
      speech.current?.stop();
      speech.current = null;
      releaseAudio();
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
    abort.current?.abort();
    abort.current = null;
    speech.current?.stop();
    speech.current = null;
    void api.ttsStop().catch(() => {});
    if (supported) window.speechSynthesis.cancel();
    if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
    speechTimer.current = null;
    releaseAudio();
    setSpeaking(false);
    setLoading(false);
  };

  const speakBrowser = (target: string): void => {
    if (!supported) {
      setUnavailable(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(target);
    utterance.lang = /[А-Яа-яЁё]/.test(target) ? "ru-RU" : "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const speak = async (): Promise<void> => {
    if (speaking || loading) {
      stop();
      return;
    }
    const gen = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    window.dispatchEvent(new CustomEvent("nit-gui:speech", { detail: owner.current }));
    const target = selectedText() || text;
    setSelection(false);
    setLoading(true);

    let started = false;
    const handle = speakHost(target, () => {
      if (gen !== generation.current) return;
      started = true;
      setLoading(false);
      setSpeaking(true);
    });
    if (handle) {
      speech.current = handle;
      try {
        await handle.done;
      } catch {}
      if (gen !== generation.current) return;
      speech.current = null;
      abort.current = null;
      if (started || handle.started()) {
        setLoading(false);
        setSpeaking(false);
        return;
      }
      if (controller.signal.aborted) {
        setLoading(false);
        setSpeaking(false);
        return;
      }
    }

    try {
      const blob = await api.ttsAudio(target, controller.signal);
      if (gen !== generation.current || controller.signal.aborted) return;
      abort.current = null;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      audio.current = player;
      audioUrl.current = url;
      player.onended = () => {
        releaseAudio();
        setSpeaking(false);
      };
      player.onerror = () => {
        releaseAudio();
        setSpeaking(false);
      };
      await player.play();
      if (gen !== generation.current) {
        releaseAudio();
        return;
      }
      setSpeaking(true);
      setLoading(false);
      return;
    } catch {
      if (gen !== generation.current || controller.signal.aborted) return;
      abort.current = null;
      releaseAudio();
    }

    try {
      await api.tts(target, controller.signal);
      if (gen !== generation.current || controller.signal.aborted) return;
      abort.current = null;
      if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
      speechTimer.current = window.setTimeout(
        () => setSpeaking(false),
        Math.min(180_000, Math.max(4_000, target.length * 55)),
      );
      setSpeaking(true);
      setLoading(false);
    } catch {
      if (gen !== generation.current || controller.signal.aborted) return;
      abort.current = null;
      speakBrowser(target);
      setLoading(false);
    }
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
      {!unavailable && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onMouseDown={(event) => {
            setSelection(Boolean(selectedText()));
            event.preventDefault();
          }}
          onTouchStart={() => setSelection(Boolean(selectedText()))}
          onClick={() => void speak()}
          aria-label={
            loading
              ? "Cancel speech preparation"
              : speaking
                ? "Stop reading"
                : selection
                  ? "Read selection"
                  : "Read aloud"
          }
          title={
            loading
              ? "Cancel speech preparation"
              : speaking
                ? "Stop reading"
                : selection
                  ? "Read selection"
                  : "Read aloud"
          }
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : speaking ? (
            <span className="read-equalizer" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <Volume2 />
          )}
          <span>{loading ? "Cancel" : speaking ? "Stop" : "Read"}</span>
        </Button>
      )}
    </div>
  );
}
