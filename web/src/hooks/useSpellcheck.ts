import { useEffect, useState } from "react";
import type { SpellIssue } from "../lib/spell";
import { checkSpelling, preloadSpellcheck } from "../lib/spell-client";

export function useSpellcheck(text: string, enabled: boolean, ignore: string[]) {
  const [issues, setIssues] = useState<SpellIssue[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void preloadSpellcheck(), 800);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setIssues([]);
      setChecking(false);
      return;
    }
    let alive = true;
    setIssues([]);
    setChecking(true);
    const timer = window.setTimeout(() => {
      checkSpelling(text, ignore)
        .then((next) => {
          if (!alive) return;
          setIssues(next);
          setChecking(false);
        })
        .catch(() => {
          if (!alive) return;
          setIssues([]);
          setChecking(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, enabled, ignore]);

  return { issues, checking };
}
