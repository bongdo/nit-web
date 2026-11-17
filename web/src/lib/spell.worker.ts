import nspell from "nspell";
import {
  findIssues,
  bestCompletion,
  prefixMatches,
  sortWords,
  unknownWords,
  languageChecker,
  primaryLanguage,
  type SpellIssue,
  type SpellChecker,
} from "./spell";

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
  language: "ru" | "en";
  checker: ReturnType<typeof nspell>;
  words: string[];
};

const scope = self as unknown as WorkerScope;

// shortcut: stems only, affixed forms are not in the list, rebuild from nspell if completions need them
function dictionaryWords(dictionary: string): string[] {
  const words = new Set<string>();
  for (const line of dictionary.split("\n")) {
    const head = line.trim().split(/[\t ]/, 1)[0];
    const word = head.split("/")[0];
    if (word && /^\p{L}/u.test(word)) words.add(word);
  }
  return sortWords(words);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`dictionary ${response.status}`);
  return response.text();
}

async function load(language: "ru" | "en"): Promise<Loaded> {
  const base = `${import.meta.env.BASE_URL}dictionaries/${language}`;
  const [aff, dic] = await Promise.all([fetchText(`${base}.aff`), fetchText(`${base}.dic`)]);
  return { language, checker: nspell(aff, dic), words: dictionaryWords(dic) };
}

const dictionaries = new Map<"ru" | "en", Promise<Loaded>>();
const suggestions = new Map<string, string[]>();
let cachedText = "";
let cachedIgnore = "";
let cachedLanguage: "ru" | "en" | null = null;
let cachedIssues: SpellIssue[] = [];

function dictionary(text: string): Promise<Loaded> {
  return byLanguage(primaryLanguage(text));
}

function byLanguage(language: "ru" | "en"): Promise<Loaded> {
  let entry = dictionaries.get(language);
  if (!entry) {
    entry = load(language).catch((error: unknown) => {
      dictionaries.delete(language);
      throw error;
    });
    dictionaries.set(language, entry);
  }
  return entry;
}

async function checkers(text: string): Promise<[SpellChecker, SpellChecker]> {
  const primary = primaryLanguage(text);
  const mixed = /\p{Script=Cyrillic}/u.test(text) && /[A-Za-z]/.test(text);
  const [ru, en] = await Promise.all([
    byLanguage(mixed ? "ru" : primary),
    byLanguage(mixed ? "en" : primary),
  ]);
  return [wrap(ru.checker, "ru"), wrap(en.checker, "en")];
}

scope.postMessage({ type: "ready" });

function wrap(checker: ReturnType<typeof nspell>, language: "ru" | "en"): SpellChecker {
  return languageChecker(
    {
      correct: (word: string) => checker.correct(word),
      suggest: (word: string) => {
        const key = `${language}:${word}`;
        let list = suggestions.get(key);
        if (!list) {
          list = checker.suggest(word);
          suggestions.set(key, list);
        }
        return list;
      },
    },
    language,
  );
}

function complete(loaded: Loaded, prefix: string, ignore: string[]): string[] {
  const lower = prefix.toLowerCase();
  if (ignore.some((word) => word.toLowerCase() === lower)) return [];
  if (loaded.checker.correct(prefix)) return [];
  const personal = ignore.filter(
    (word) => word.length > prefix.length && word.toLowerCase().startsWith(lower),
  );
  const best =
    bestCompletion(personal, prefix) ??
    bestCompletion(prefixMatches(loaded.words, prefix, 80), prefix);
  if (!best) return [];
  return [/^\p{Lu}/u.test(prefix) ? best[0].toUpperCase() + best.slice(1) : best];
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "learn") {
    void dictionary(request.text)
      .then((loaded) => {
        const checker = wrap(loaded.checker, loaded.language);
        scope.postMessage({
          type: "learned",
          id: request.id,
          words: unknownWords(request.text, checker, checker, new Set(request.ignore)),
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
      });
    return;
  }
  if (request.kind === "completion") {
    void dictionary(request.prefix)
      .then((loaded) => {
        scope.postMessage({
          type: "completion",
          id: request.id,
          words: complete(loaded, request.prefix, request.ignore),
        });
      })
      .catch((error: unknown) => {
        scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
      });
    return;
  }
  const ignoreKey = request.ignore.join("\u0000");
  const language = primaryLanguage(request.text);
  if (request.text === cachedText && ignoreKey === cachedIgnore && language === cachedLanguage) {
    scope.postMessage({ type: "issues", id: request.id, issues: cachedIssues });
    return;
  }
  void dictionary(request.text)
    .then((loaded) => {
      const checker = wrap(loaded.checker, loaded.language);
      const issues = findIssues(request.text, checker, checker, new Set(request.ignore));
      cachedText = request.text;
      cachedIgnore = ignoreKey;
      cachedLanguage = loaded.language;
      cachedIssues = issues;
      scope.postMessage({ type: "issues", id: request.id, issues });
    })
    .catch((error: unknown) => {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "dictionary failed" });
    });
};
