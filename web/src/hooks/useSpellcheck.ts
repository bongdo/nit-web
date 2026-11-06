import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { grammarIssues, mergeIssues, type SpellIssue } from "../lib/spell";
import { checkSpelling, preloadSpellcheck } from "../lib/spell-client";

let grammarCooldownUntil = 0;

export function useSpellcheck(text: string, enabled: boolean, ignore: string[]) {
  const [spelling, setSpelling] = useState<SpellIssue[]>([]);
  const [grammar, setGrammar] = useState<SpellIssue[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void preloadSpellcheck(), 800);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setSpelling([]);
      return;
    }
    let alive = true;
    setSpelling([]);
    const timer = window.setTimeout(() => {
      checkSpelling(text, ignore)
        .then((next) => {
          if (alive) setSpelling(next);
        })
        .catch(() => {
          if (alive) setSpelling([]);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, enabled, ignore]);

  useEffect(() => {
    if (!enabled || !text.trim() || text.length > 8000 || Date.now() < grammarCooldownUntil) {
      setGrammar([]);
      return;
    }
    let alive = true;
    setGrammar([]);
    const timer = window.setTimeout(() => {
      api
        .grammar(text)
        .then((matches) => {
          grammarCooldownUntil = 0;
          if (alive) setGrammar(grammarIssues(text, matches));
        })
        .catch(() => {
          grammarCooldownUntil = Date.now() + 60_000;
          if (alive) setGrammar([]);
        });
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, enabled]);

  return { issues: mergeIssues(spelling, grammar) };
}
