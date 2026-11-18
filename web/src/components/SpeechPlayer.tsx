import { Loader2, Pause, Play, SkipBack, X } from "lucide-react";
import {
  SPEECH_RATES,
  pauseSpeech,
  previousBlock,
  resumeSpeech,
  setSpeechRate,
  stopSpeech,
  useSpeech,
} from "../lib/speech";
import { Button } from "./ui/button";

export function SpeechPlayer() {
  const state = useSpeech();
  if (state.phase === "idle") return null;

  const busy = state.phase === "loading";
  const nextRate = () => {
    const index = SPEECH_RATES.indexOf(state.rate);
    setSpeechRate(SPEECH_RATES[(index + 1) % SPEECH_RATES.length]);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-2">
      <div className="bg-card/95 border-border pointer-events-auto flex items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-lg backdrop-blur">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            if (state.phase === "playing") pauseSpeech();
            else if (state.phase === "paused") resumeSpeech();
            else stopSpeech();
          }}
          aria-label={busy ? "Cancel speech preparation" : state.phase === "playing" ? "Pause reading" : "Resume reading"}
          title={busy ? "Cancel speech preparation" : state.phase === "playing" ? "Pause reading" : "Resume reading"}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : state.phase === "playing" ? (
            <Pause />
          ) : (
            <Play />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={previousBlock}
          disabled={!state.anchored}
          aria-label="Previous paragraph"
          title="Previous paragraph"
        >
          <SkipBack />
        </Button>
        <span className="text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs">
          {busy ? "Preparing voice…" : state.phase === "paused" ? "Paused" : "Reading"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground font-mono text-xs"
          onClick={nextRate}
          aria-label={`Reading speed ${state.rate} times`}
          title="Reading speed"
        >
          {state.rate}×
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={stopSpeech}
          aria-label="Stop reading"
          title="Stop reading"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
