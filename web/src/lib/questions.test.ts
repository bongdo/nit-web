import { describe, expect, it } from "vitest";
import { parseAnswers, parseQuestions, questionRecords } from "./questions";
import type { ToolPart } from "./types";

function part(state: Partial<ToolPart["state"]> = {}): ToolPart {
  return {
    type: "tool",
    id: "q1",
    name: "question",
    state: { status: "completed", ...state },
  };
}

describe("parseQuestions", () => {
  it("reads a questions array and normalizes option shapes", () => {
    expect(
      parseQuestions({
        questions: [
          {
            header: "Pick",
            question: "Which one?",
            options: [{ label: "A", description: "first" }],
          },
          { question: "Second?", options: ["B", "C"] },
        ],
      }),
    ).toEqual([
      {
        header: "Pick",
        question: "Which one?",
        options: [{ label: "A", description: "first" }],
        answers: [],
      },
      {
        header: undefined,
        question: "Second?",
        options: [{ label: "B" }, { label: "C" }],
        answers: [],
      },
    ]);
  });

  it("reads a single question object", () => {
    expect(parseQuestions({ question: "Continue?", options: [{ label: "Yes" }] })).toEqual([
      {
        header: undefined,
        question: "Continue?",
        options: [{ label: "Yes" }],
        answers: [],
      },
    ]);
  });

  it("reads a single question under questions", () => {
    expect(parseQuestions({ questions: { question: "Continue?" } })).toEqual([
      { header: undefined, question: "Continue?", options: [], answers: [] },
    ]);
  });

  it("reads a plain string", () => {
    expect(parseQuestions("Continue?")).toEqual([
      { header: undefined, question: "Continue?", options: [], answers: [] },
    ]);
  });

  it("reads JSON encoded input", () => {
    expect(parseQuestions('{"questions":[{"question":"Pick","options":["A"]}]}')).toEqual([
      { header: undefined, question: "Pick", options: [{ label: "A" }], answers: [] },
    ]);
  });

  it("ignores malformed input", () => {
    expect(parseQuestions(null)).toEqual([]);
    expect(parseQuestions({})).toEqual([]);
    expect(parseQuestions({ questions: [] })).toEqual([]);
    expect(parseQuestions([""])).toEqual([]);
  });
});

describe("parseAnswers", () => {
  const questions = parseQuestions({
    questions: [{ question: "First" }, { header: "Second", question: "Second?" }],
  });

  it("reads nested answers", () => {
    expect(parseAnswers([["A"], ["B"]], questions)).toEqual([["A"], ["B"]]);
  });

  it("reads flat answers as one answer per question", () => {
    expect(parseAnswers(["A", "B"], questions)).toEqual([["A"], ["B"]]);
  });

  it("keeps flat multi-select answers for a single question", () => {
    expect(parseAnswers(["A", "B"], parseQuestions({ question: "Pick" }))).toEqual([["A", "B"]]);
  });

  it("reads an object map by index, question text or header", () => {
    expect(parseAnswers({ "0": ["A"], "Second?": "B" }, questions)).toEqual([["A"], ["B"]]);
    expect(parseAnswers({ First: "A", Second: "B" }, questions)).toEqual([["A"], ["B"]]);
  });

  it("reads arbitrary object values in order", () => {
    expect(parseAnswers({ first: "A", second: "B" }, questions)).toEqual([["A"], ["B"]]);
  });

  it("falls back to content when answers are empty", () => {
    expect(parseAnswers(undefined, questions, "User answered: A")).toEqual([
      ["User answered: A"],
      [],
    ]);
    expect(parseAnswers([[], []], questions, "User answered: A")).toEqual([
      ["User answered: A"],
      [],
    ]);
  });
});

describe("questionRecords", () => {
  it("merges normalized questions with metadata answers", () => {
    expect(
      questionRecords(
        part({
          input: {
            questions: [
              {
                header: "Pick",
                question: "Which?",
                options: [{ label: "A", description: "first" }],
              },
            ],
          },
          metadata: { answers: [["A"]] },
          content: [{ type: "text", text: "User answered: A" }],
        }),
      ),
    ).toEqual([
      {
        header: "Pick",
        question: "Which?",
        options: [{ label: "A", description: "first" }],
        answers: ["A"],
      },
    ]);
  });

  it("uses content when metadata has no answers", () => {
    expect(
      questionRecords(
        part({
          input: "Continue?",
          content: [{ type: "text", text: "User answered: yes" }],
        }),
      ),
    ).toEqual([
      {
        header: undefined,
        question: "Continue?",
        options: [],
        answers: ["User answered: yes"],
      },
    ]);
  });

  it("returns no records without a question", () => {
    expect(questionRecords(part({ input: {} }))).toEqual([]);
  });
});
