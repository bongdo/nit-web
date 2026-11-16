import { useEffect, useState } from "react";
import { completeSpelling } from "../lib/spell-client";
import { languageOf, maskedAt, pendingWord } from "../lib/spell";

export type Completion = { start: number; prefix: string; tail: string };

export function useCompletion(
  text: string,
  caret: number | null,
  enabled: boolean,
  ignore: string[],
): Completion | null {
  const [ghost, setGhost] = useState<Completion | null>(null);

  useEffect(() => {
    setGhost(null);
    if (!enabled || caret === null) return;
    const pending = pendingWord(text, caret);
    if (!pending) return;
    const prefix = text.slice(pending.start, pending.end);
    if (prefix.length < 2 || !languageOf(prefix)) return;
    if (text.startsWith("/") && !text.includes("\n")) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (maskedAt(text, pending.start)) return;
      void completeSpelling(prefix, ignore)
        .then((words) => {
          if (!alive) return;
          const word = words[0];
          if (!word || word.length <= prefix.length) return;
          setGhost({ start: pending.start, prefix, tail: word.slice(prefix.length) });
        })
        .catch(() => undefined);
    }, 140);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, caret, enabled, ignore]);

  if (
    !ghost ||
    caret !== text.length ||
    text.slice(ghost.start, ghost.start + ghost.prefix.length) !== ghost.prefix ||
    text.slice(ghost.start + ghost.prefix.length) !== ""
  ) {
    return null;
  }
  return ghost;
}
