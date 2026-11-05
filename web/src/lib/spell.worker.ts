import nspell from "nspell";
import enAffUrl from "dictionary-en-aff?url";
import enDicUrl from "dictionary-en-dic?url";
import ruAffUrl from "dictionary-ru-aff?url";
import ruDicUrl from "dictionary-ru-dic?url";
import { findIssues, type SpellIssue } from "./spell";

type Request = {
  id: number;
  text: string;
  ignore: string[];
};

type Response =
  | { type: "ready" }
  | { type: "issues"; id: number; issues: SpellIssue[] }
  | { type: "error"; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (value: Response) => void;
};

const scope = self as unknown as WorkerScope;

async function load() {
  const files = await Promise.all(
    [ruAffUrl, ruDicUrl, enAffUrl, enDicUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`dictionary ${response.status}`);
      return response.text();
    }),
  );
  return {
    ru: nspell(files[0], files[1]),
    en: nspell(files[2], files[3]),
  };
}

let loaded: Promise<{ ru: ReturnType<typeof nspell>; en: ReturnType<typeof nspell> }> | null = null;
const suggestions = new Map<string, string[]>();
let cachedText = "";
let cachedIgnore = "";
let cachedIssues: SpellIssue[] = [];

const ready = (loaded ??= load());
void ready
  .then(() => scope.postMessage({ type: "ready" }))
  .catch((error: unknown) => {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
  });

scope.onmessage = (event) => {
  const request = event.data;
  const ignoreKey = request.ignore.join("\u0000");
  if (request.text === cachedText && ignoreKey === cachedIgnore) {
    scope.postMessage({ type: "issues", id: request.id, issues: cachedIssues });
    return;
  }
  void ready
    .then(({ ru, en }) => {
      const wrap = (checker: ReturnType<typeof nspell>) => ({
        correct: (word: string) => checker.correct(word),
        suggest: (word: string) => {
          const key = word.toLowerCase();
          let list = suggestions.get(key);
          if (!list) {
            list = checker.suggest(word);
            suggestions.set(key, list);
          }
          return list;
        },
      });
      const issues = findIssues(request.text, wrap(ru), wrap(en), new Set(request.ignore));
      cachedText = request.text;
      cachedIgnore = ignoreKey;
      cachedIssues = issues;
      scope.postMessage({ type: "issues", id: request.id, issues });
    })
    .catch((error: unknown) => {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
    });
};
