import { readFileSync } from "node:fs";
import nspell from "nspell";
import { describe, expect, it } from "vitest";
import {
  addsOnlyPunctuation,
  allowedWord,
  applyIssue,
  bestCompletion,
  findIssues,
  fixIntact,
  fixSignature,
  grammarIssues,
  hidePending,
  issueAtCaret,
  keepStale,
  languageOf,
  levenshtein,
  maskCode,
  maskedAt,
  mergeIssues,
  pendingWord,
  prefixMatches,
  punctuationFix,
  safeAutoFix,
  sortWords,
  unknownWords,
  words,
  type SpellChecker,
  type SpellIssue,
} from "./spell";

const ru: SpellChecker = {
  correct: (word) =>
    [
      "в",
      "грамматики",
      "должен",
      "же",
      "ну",
      "пришёл",
      "файл",
      "я",
      "какой",
      "кто",
      "нибудь",
      "облако",
      "орфографии",
      "проверку",
      "текст",
      "то",
      "уходил",
      "хочу",
    ].includes(word.toLowerCase()),
  suggest: (word) => {
    if (word.toLowerCase() === "хочю") return ["хочу"];
    if (word.toLowerCase() === "граматики") return ["грамматики"];
    if (word.toLowerCase() === "та") return ["то"];
    if (word.toLowerCase() === "cкачать") return ["скачать"];
    return [];
  },
};

const en: SpellChecker = {
  correct: (word) =>
    [
      "and",
      "appear",
      "bad",
      "box",
      "executable",
      "is",
      "open",
      "read",
      "run",
      "use",
      "composer",
      "correction",
      "ghost",
      "grammar",
      "i",
      "it",
      "should",
      "spellcheck",
      "stop",
      "tab",
      "text",
      "the",
      "to",
      "typing",
      "when",
    ].includes(word.toLowerCase()),
  suggest: (word) => (word.toLowerCase() === "grammer" ? ["grammar"] : []),
};

const realEn: SpellChecker = (() => {
  const read = (name: string) =>
    readFileSync(new URL(`../../node_modules/dictionary-en/index.${name}`, import.meta.url), "utf8");
  const checker = nspell(read("aff"), read("dic"));
  return { correct: (word) => checker.correct(word), suggest: (word) => checker.suggest(word) };
})();

describe("spell", () => {
  it("keeps offsets when masking code, paths, urls and inline code", () => {
    const text = [
      "run `bin/check` and open Composer.tsx",
      "see https://example.com/a?b=1",
      "```go",
      "fmt.Println(\"хочю\")",
      "```",
      "then ask opencode",
    ].join("\n");
    const masked = maskCode(text);
    expect(masked.length).toBe(text.length);
    expect(masked).not.toContain("bin/check");
    expect(masked).not.toContain("Composer.tsx");
    expect(masked).not.toContain("example.com");
    expect(masked).not.toContain("хочю");
    expect(maskCode("text ```go\nfmt.Println(\"хочю\")")).not.toContain("хочю");
    expect(maskCode("use `opencode")).not.toContain("opencode");
  });

  it("tokenizes hyphenated words as one word with offsets", () => {
    const text = "ну кто-то же должен";
    const tokens = words(text);
    expect(tokens.map((item) => item.value)).toEqual(["ну", "кто-то", "же", "должен"]);
    expect(text.slice(tokens[1].start, tokens[1].end)).toBe("кто-то");
  });

  it("detects the script of a word", () => {
    expect(languageOf("хочю")).toBe("ru");
    expect(languageOf("grammer")).toBe("en");
    expect(languageOf("cкачать")).toBe("mixed");
    expect(languageOf("123")).toBeNull();
  });

  it("finds Russian and English misspellings", () => {
    expect(findIssues("я хочю проверку", ru, en)).toMatchObject([
      { word: "хочю", suggestions: ["хочу"], language: "ru", start: 2, end: 6 },
    ]);
    expect(findIssues("the grammer is bad", ru, en)).toMatchObject([
      { word: "grammer", suggestions: ["grammar"], language: "en", start: 4, end: 11 },
    ]);
  });

  it("skips code, paths, urls and known project words", () => {
    const text =
      "run bin/check, open Composer.tsx, read https://example.com, use `opencode` and nit-gui";
    expect(findIssues(text, ru, en)).toEqual([]);
  });

  it("checks each part of a hyphenated word", () => {
    const issues = findIssues("кто-та пришёл", ru, en);
    expect(issues).toMatchObject([{ word: "та", suggestions: ["то"], start: 4, end: 6 }]);
  });

  it("tries the Russian dictionary for mixed-script typos", () => {
    const issues = findIssues("cкачать файл", ru, en);
    expect(issues).toMatchObject([{ word: "cкачать", suggestions: ["скачать"], language: "mixed" }]);
  });

  it("honours the ignore list", () => {
    expect(findIssues("хочю", ru, en, new Set(["хочю"]))).toEqual([]);
  });

  it("applies a suggestion by offsets", () => {
    const issue = findIssues("я хочю проверку", ru, en)[0];
    expect(applyIssue("я хочю проверку", issue, "хочу")).toBe("я хочу проверку");
  });

  it("finds the issue at the caret", () => {
    const issues = findIssues("я хочю проверку", ru, en);
    expect(issueAtCaret(issues, 2)?.word).toBe("хочю");
    expect(issueAtCaret(issues, 6)?.word).toBe("хочю");
    expect(issueAtCaret(issues, 7)).toBeNull();
    expect(issueAtCaret(issues, 7, "я хочю ")?.word).toBe("хочю");
    expect(issueAtCaret(issues, 7, "я хочю проверку")).toBeNull();
    expect(issueAtCaret(issues, null)).toBeNull();
  });

  it("maps grammar matches and drops out-of-range ones", () => {
    const text = "привет мир";
    const issues = grammarIssues(text, [
      { offset: 7, length: 3, message: "comma", ruleID: "A_NO_DA", replacements: ["мир!"] },
      { offset: 20, length: 4, message: "gone", ruleID: "A_NO_DA", replacements: ["x"] },
    ]);
    expect(issues).toEqual([
      {
        start: 7,
        end: 10,
        word: "мир",
        suggestions: ["мир!"],
        language: "ru",
        source: "grammar",
        message: "comma",
      },
    ]);
  });

  it("drops whitespace around grammar matches and empty ranges", () => {
    const text = "привет мир \n";
    const issues = grammarIssues(text, [
      { offset: 6, length: 5, message: "space", ruleID: "X", replacements: ["мир!"] },
      { offset: 11, length: 2, message: "blank", ruleID: "X", replacements: ["x"] },
    ]);
    expect(issues).toEqual([
      {
        start: 7,
        end: 10,
        word: "мир",
        suggestions: ["мир!"],
        language: "ru",
        source: "grammar",
        message: "space",
      },
    ]);
  });

  it("prefers spelling issues when grammar matches overlap them", () => {
    const spelling = findIssues("я хочю", ru, en);
    const grammar = grammarIssues("я хочю", [
      { offset: 2, length: 4, message: "overlap", ruleID: "X", replacements: ["хочу"] },
    ]);
    const merged = mergeIssues(spelling, grammar);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("spell");
  });

  it("measures edit distance", () => {
    expect(levenshtein("хочю", "хочу")).toBe(1);
    expect(levenshtein("grammer", "grammar")).toBe(1);
    expect(levenshtein("граматики", "грамматики")).toBe(1);
    expect(levenshtein("кот", "кто")).toBe(2);
  });

  it("auto-fixes only unambiguous lowercase words", () => {
    expect(safeAutoFix("граматики", ["грамматики", "грамотеи"])).toBe("грамматики");
    expect(safeAutoFix("grammer", ["grammar"])).toBe("grammar");
    expect(safeAutoFix("grammer", ["grammar", "grimmer"])).toBeNull();
    expect(safeAutoFix("хочю", ["холю", "хорю", "хочу"])).toBeNull();
    expect(safeAutoFix("Хочю", ["хочу"])).toBeNull();
    expect(safeAutoFix("кот", ["кто"])).toBeNull();
    expect(safeAutoFix("кто-то", ["кто-то"])).toBeNull();
    expect(safeAutoFix("лут", ["лук"])).toBe("лук");
  });

  it("hides every mark that touches the word being typed", () => {
    const word: SpellIssue = {
      start: 0,
      end: 5,
      word: "ситуа",
      suggestions: [],
      language: "ru",
      source: "spell",
    };
    const phrase: SpellIssue = {
      start: 0,
      end: 5,
      word: "ситуа",
      suggestions: ["ситуация"],
      language: "ru",
      source: "grammar",
    };
    const stale: SpellIssue = { ...word, end: 3 };
    expect(hidePending([word], "ситуа", 5)).toEqual([]);
    expect(hidePending([phrase], "ситуа", 5)).toEqual([]);
    expect(hidePending([stale], "ситуа", 5)).toEqual([]);
    expect(hidePending([word], "ситуа", 3)).toEqual([word]);
    expect(hidePending([word], "ситуа ", 6)).toEqual([word]);
    expect(hidePending([word], "ситуа", null)).toEqual([word]);
    expect(pendingWord("я, а ощщо", 9)).toEqual({ start: 5, end: 9 });
    expect(pendingWord("я, а ощщо ", 10)).toBeNull();
    expect(pendingWord("я, а ощщо", 4)).toBeNull();
  });

  it("finds completions by prefix", () => {
    const sorted = ["бар", "баран", "батон", "ситуация", "я"];
    expect(prefixMatches(sorted, "ба")).toEqual(["бар", "баран", "батон"]);
    expect(prefixMatches(sorted, "бара")).toEqual(["баран"]);
    expect(prefixMatches(sorted, "Ба")).toEqual(["бар", "баран", "батон"]);
    expect(prefixMatches(sorted, "ситуа")).toEqual(["ситуация"]);
    expect(prefixMatches(sorted, "zzz")).toEqual([]);
    expect(prefixMatches(sorted, "")).toEqual([]);
  });

  it("accepts only punctuation insertions from grammar", () => {
    expect(addsOnlyPunctuation("ситуация где", "ситуация, где")).toBe(true);
    expect(addsOnlyPunctuation("проверку но", "проверку, но")).toBe(true);
    expect(addsOnlyPunctuation("ситуация где", "ситуации где")).toBe(false);
    expect(addsOnlyPunctuation("слово", "слово")).toBe(false);
    expect(addsOnlyPunctuation("слово", "слова")).toBe(false);
  });

  it("collects unknown words from chat text", () => {
    expect(
      unknownWords("привет хочю просмотршик run opencode bin/check", ru, en, new Set(["просмотршик"])),
    ).toEqual(["привет", "хочю"]);
    expect(unknownWords("кто-нибудь", ru, en)).toEqual([]);
    expect(unknownWords("хочю-хочю", ru, en)).toEqual(["хочю"]);
    expect(unknownWords("в", ru, en)).toEqual([]);
  });

  it("detects code and path positions", () => {
    expect(maskedAt("run `bin/check`", 5)).toBe(true);
    expect(maskedAt("run bin/check", 4)).toBe(true);
    expect(maskedAt("hello world", 0)).toBe(false);
  });

  it("allows the Russian subagent forms", () => {
    expect(allowedWord("субагенты")).toBe(true);
    expect(allowedWord("субагентов")).toBe(true);
    expect(allowedWord("сабагенты")).toBe(false);
  });

  it("keeps stale underlines only before the first edit", () => {
    const issues: SpellIssue[] = [
      { start: 0, end: 4, word: "хочю", suggestions: ["хочу"], language: "ru" },
      { start: 5, end: 9, word: "грам", suggestions: ["грамм"], language: "ru" },
    ];
    expect(keepStale("хочю грам", "хочю грам ", issues)).toHaveLength(2);
    expect(keepStale("хочю грам", "хочю грамма", issues)).toHaveLength(1);
    expect(keepStale("хочю грам", "хочю хграм", issues)).toHaveLength(1);
    expect(keepStale("хочю грам", "хочю г", issues)).toHaveLength(1);
    expect(keepStale("хочю грам", "хочю ", issues)).toHaveLength(1);
    expect(keepStale("хочю грам", "Хочю грам", issues)).toHaveLength(0);
  });

  it("drops a stale mark when the word gets another letter", () => {
    const issues: SpellIssue[] = [
      { start: 4, end: 11, word: "наблюда", suggestions: [], language: "ru" },
    ];
    expect(keepStale("это наблюда", "это наблюдаю", issues)).toHaveLength(0);
  });

  it("accepts English plurals of known words", () => {
    expect(findIssues("executables", ru, en)).toEqual([]);
    expect(findIssues("boxes", ru, en)).toEqual([]);
    expect(findIssues("executablse", ru, en)).toHaveLength(1);
    expect(unknownWords("executables boxes", ru, en)).toEqual([]);
  });

  it("accepts the plural of an affix-derived word from the real dictionary", () => {
    expect(realEn.correct("executable")).toBe(true);
    expect(realEn.correct("executables")).toBe(false);
    expect(findIssues("executables", ru, realEn)).toEqual([]);
    expect(safeAutoFix("executables", ["executable"])).toBeNull();
  });

  it("never marks part of a word or a range that no longer matches the text", () => {
    const stale: SpellIssue = {
      start: 4,
      end: 11,
      word: "наблюда",
      suggestions: ["наблюдать"],
      language: "ru",
    };
    expect(hidePending([stale], "это наблюдаю", 13)).toEqual([]);
    expect(hidePending([stale], "это наблюдаю", null)).toEqual([]);
    expect(hidePending([stale], "это наблюдаю и пишу", 13)).toEqual([]);
    const shifted: SpellIssue = { ...stale, start: 5, end: 8 };
    expect(hidePending([shifted], "это наблюдаю", null)).toEqual([]);
    expect(hidePending([{ ...stale, start: 0, end: 7, word: "это наб" }], "это наблюдаю", null)).toEqual([]);
  });

  it("keeps a mark on a whole word and on a hyphen part", () => {
    const whole: SpellIssue = {
      start: 4,
      end: 12,
      word: "наблюдаю",
      suggestions: [],
      language: "ru",
    };
    expect(hidePending([whole], "это наблюдаю", 13)).toHaveLength(1);
    expect(hidePending([whole], "это наблюдаю ", 13)).toHaveLength(1);
    const part: SpellIssue = { start: 4, end: 6, word: "та", suggestions: ["то"], language: "ru" };
    expect(hidePending([part], "кто-та пришёл", null)).toHaveLength(1);
  });

  it("does not strip an inflection when auto-fixing", () => {
    expect(safeAutoFix("executables", ["executable"])).toBeNull();
    expect(safeAutoFix("executable", ["executables"])).toBeNull();
    expect(safeAutoFix("closed", ["close"])).toBeNull();
    expect(safeAutoFix("runn", ["run"])).toBe("run");
    expect(safeAutoFix("grammer", ["grammar"])).toBe("grammar");
  });

  it("sorts dictionary words so a lowercase prefix search finds them", () => {
    const mixed = sortWords(["Box", "abbey", "aback"]);
    expect(mixed).toEqual(["aback", "abbey", "Box"]);
    expect(prefixMatches(mixed, "ab")).toEqual(["aback", "abbey"]);
    expect(prefixMatches(sortWords(["Navajo", "naval", "nave"]), "nav")).toEqual([
      "Navajo",
      "naval",
      "nave",
    ]);
  });

  it("prefers a lowercase completion for a lowercase prefix", () => {
    expect(bestCompletion(["GMAT", "gmail"], "gma")).toBe("gmail");
    expect(bestCompletion(["GMAT"], "gma")).toBeNull();
    expect(bestCompletion(["Москва"], "мос")).toBeNull();
    expect(bestCompletion(["Москва"], "Мос")).toBe("Москва");
    expect(bestCompletion(["ситуация"], "ситуа")).toBe("ситуация");
  });

  it("re-applies no punctuation fix the user rejected", () => {
    const text = "проверку но";
    const issues = grammarIssues(text, [
      { offset: 0, length: 8, message: "comma", ruleID: "X", replacements: ["проверку,"] },
    ]);
    expect(punctuationFix(issues, 10, new Set())?.replacement).toBe("проверку,");
    expect(punctuationFix(issues, 7, new Set())).toBeNull();
    const rejected = new Set([fixSignature("проверку", "проверку,")]);
    expect(punctuationFix(issues, 10, rejected)).toBeNull();
  });

  it("knows when an applied fix is still intact", () => {
    expect(fixIntact({ start: 2, replacement: "грамматики" }, "я грамматики")).toBe(true);
    expect(fixIntact({ start: 2, replacement: "грамматики" }, "я грамматик")).toBe(false);
    expect(fixIntact({ start: 2, replacement: "грамматики" }, "ты грамматики")).toBe(false);
  });
});
