import { Loader2, Pause, Play, SkipBack, X } from "lucide-react";
import {
  SPEECH_RATES,
  pauseSpeech,
  previousSentence,
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
    <div className="mx-auto flex w-full max-w-3xl px-4 pt-1.5">
      <div className="bg-card/85 border-border/70 pointer-events-auto inline-flex items-center gap-0.5 rounded-full border pr-1 pl-0.5 shadow-sm backdrop-blur">
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
          onClick={previousSentence}
          disabled={!state.anchored}
          aria-label="Previous sentence"
          title="Previous sentence"
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground h-6 px-1.5 font-mono text-[10px]"
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
