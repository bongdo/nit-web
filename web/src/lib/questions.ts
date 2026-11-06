import type { ToolPart } from "./types";

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionRecord = {
  header?: string;
  question: string;
  options: QuestionOption[];
  answers: string[];
};

export function parseQuestions(input: unknown): QuestionRecord[] {
  return questionItems(input)
    .map(normalizeQuestion)
    .filter((question): question is QuestionRecord => question !== null);
}

export function parseAnswers(
  value: unknown,
  questions: QuestionRecord[],
  content = "",
): string[][] {
  const groups = answerGroups(value, questions);
  if (groups.some((group) => group.length > 0)) {
    return questions.map((_, index) => groups[index] ?? []);
  }
  const fallback = content.trim();
  return questions.map((_, index) => (index === 0 && fallback ? [fallback] : []));
}

export function questionRecords(part: ToolPart): QuestionRecord[] {
  const questions = parseQuestions(part.state.input);
  if (questions.length === 0) return [];
  const content = (part.state.content ?? [])
    .map((item) => item.text ?? "")
    .filter((text) => text !== "")
    .join("\n");
  const answers = parseAnswers(part.state.metadata?.answers, questions, content);
  return questions.map((question, index) => ({
    ...question,
    answers: answers[index] ?? [],
  }));
}

function questionItems(input: unknown): unknown[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  if (record.questions !== undefined) {
    return Array.isArray(record.questions) ? record.questions : [record.questions];
  }
  if (record.question !== undefined || record.options !== undefined) return [record];
  return [];
}

function normalizeQuestion(value: unknown): QuestionRecord | null {
  if (typeof value === "string") {
    const question = value.trim();
    return question ? { question, options: [], answers: [] } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question.trim() : "";
  const options = normalizeOptions(record.options);
  if (!question && options.length === 0) return null;
  const header =
    typeof record.header === "string" && record.header.trim() ? record.header : undefined;
  return { header, question: question || "Question", options, answers: [] };
}

function normalizeOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  const options: QuestionOption[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.trim()) options.push({ label: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : "";
    if (!label.trim()) continue;
    options.push({
      label,
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description
          : undefined,
    });
  }
  return options;
}

function answerGroups(value: unknown, questions: QuestionRecord[]): string[][] {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      const flat = value.filter((item): item is string => item.trim() !== "");
      return questions.length > 1 ? flat.map((item) => [item]) : [flat];
    }
    return value.map(stringsOf);
  }
  if (!value || typeof value !== "object") return [];
  const map = value as Record<string, unknown>;
  const keyed = questions.some(
    (question, index) =>
      Object.hasOwn(map, String(index)) ||
      Object.hasOwn(map, question.question) ||
      (question.header !== undefined && Object.hasOwn(map, question.header)),
  );
  if (keyed) {
    return questions.map((question, index) =>
      stringsOf(
        map[String(index)] ??
          map[question.question] ??
          (question.header !== undefined ? map[question.header] : undefined),
      ),
    );
  }
  return Object.values(map).map(stringsOf);
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  return [];
}
