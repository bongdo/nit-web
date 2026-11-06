import { describe, expect, it } from "vitest";
import {
  allowedWord,
  applyIssue,
  findIssues,
  grammarIssues,
  issueAtCaret,
  languageOf,
  levenshtein,
  maskCode,
  maskedAt,
  mergeIssues,
  safeAutoFix,
  words,
  type SpellChecker,
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
});
