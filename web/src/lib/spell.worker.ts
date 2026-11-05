import nspell from "nspell";
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
const files = ["/dictionaries/ru.aff", "/dictionaries/ru.dic", "/dictionaries/en.aff", "/dictionaries/en.dic"];

async function load() {
  const [ruAff, ruDic, enAff, enDic] = await Promise.all(
    files.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`dictionary ${response.status}`);
      return response.text();
    }),
  );
  return { ru: nspell(ruAff, ruDic), en: nspell(enAff, enDic) };
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
          let list = suggestions.get(word);
          if (!list) {
            list = checker.suggest(word);
            suggestions.set(word, list);
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
