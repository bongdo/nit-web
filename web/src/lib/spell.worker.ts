import nspell from "nspell";
import { findIssues, prefixMatches, unknownWords, type SpellIssue, type SpellChecker } from "./spell";

type IssuesRequest = { kind?: "issues"; id: number; text: string; ignore: string[] };
type CompletionRequest = { kind: "completion"; id: number; prefix: string; ignore: string[] };
type LearnRequest = { kind: "learn"; id: number; text: string; ignore: string[] };
type Request = IssuesRequest | CompletionRequest | LearnRequest;

type Response =
  | { type: "ready" }
  | { type: "issues"; id: number; issues: SpellIssue[] }
  | { type: "completion"; id: number; words: string[] }
  | { type: "learned"; id: number; words: string[] }
  | { type: "error"; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (value: Response) => void;
};

type Loaded = {
  ru: ReturnType<typeof nspell>;
  en: ReturnType<typeof nspell>;
  ruWords: string[];
  enWords: string[];
};

const scope = self as unknown as WorkerScope;
const files = [
  `${import.meta.env.BASE_URL}dictionaries/ru.aff`,
  `${import.meta.env.BASE_URL}dictionaries/ru.dic`,
  `${import.meta.env.BASE_URL}dictionaries/en.aff`,
  `${import.meta.env.BASE_URL}dictionaries/en.dic`,
];

// shortcut: stems only, affixed forms are not in the list, rebuild from nspell if completions need them
function dictionaryWords(dictionary: string): string[] {
  const words = new Set<string>();
  for (const line of dictionary.split("\n")) {
    const head = line.trim().split(/[\t ]/, 1)[0];
    const word = head.split("/")[0];
    if (word && /^\p{L}/u.test(word)) words.add(word);
  }
  return Array.from(words).sort();
}

async function load(): Promise<Loaded> {
  const [ruAff, ruDic, enAff, enDic] = await Promise.all(
    files.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`dictionary ${response.status}`);
      return response.text();
    }),
  );
  return {
    ru: nspell(ruAff, ruDic),
    en: nspell(enAff, enDic),
    ruWords: dictionaryWords(ruDic),
    enWords: dictionaryWords(enDic),
  };
}

let loaded: Promise<Loaded> | null = null;
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

function wrap(checker: ReturnType<typeof nspell>): SpellChecker {
  return {
    correct: (word: string) => checker.correct(word),
    suggest: (word: string) => {
      let list = suggestions.get(word);
      if (!list) {
        list = checker.suggest(word);
        suggestions.set(word, list);
      }
      return list;
    },
  };
}

function complete(dictionaries: Loaded, prefix: string, ignore: string[]): string[] {
  const lower = prefix.toLowerCase();
  if (ignore.some((word) => word.toLowerCase() === lower)) return [];
  if (dictionaries.ru.correct(prefix) || dictionaries.en.correct(prefix)) return [];
  const candidates = [
    ...prefixMatches(dictionaries.ruWords, prefix, 80),
    ...prefixMatches(dictionaries.enWords, prefix, 80),
    ...ignore.filter((word) => word.length > prefix.length && word.toLowerCase().startsWith(lower)),
  ];
  const best = candidates
    .filter((word) => word.length > prefix.length)
    .sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0))[0];
  if (!best) return [];
  return [/^\p{Lu}/u.test(prefix) ? best[0].toUpperCase() + best.slice(1) : best];
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "learn") {
    void ready
      .then(({ ru, en }) => {
        scope.postMessage({
          type: "learned",
          id: request.id,
          words: unknownWords(request.text, wrap(ru), wrap(en), new Set(request.ignore)),
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
      });
    return;
  }
  if (request.kind === "completion") {
    void ready
      .then((dictionaries) => {
        scope.postMessage({
          type: "completion",
          id: request.id,
          words: complete(dictionaries, request.prefix, request.ignore),
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
      });
    return;
  }
  const ignoreKey = request.ignore.join("\u0000");
  if (request.text === cachedText && ignoreKey === cachedIgnore) {
    scope.postMessage({ type: "issues", id: request.id, issues: cachedIssues });
    return;
  }
  void ready
    .then(({ ru, en }) => {
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
