import { describe, expect, it } from "vitest";
import {
  initialFormValues,
  isEmptyAnswer,
  isFieldVisible,
  questionAnswer,
  questionFields,
  visibleFormFields,
} from "./forms";
import type { FormField, FormInfo } from "./types";

function form(overrides: Partial<FormInfo> = {}): FormInfo {
  return {
    id: "frm_1",
    sessionID: "ses_1",
    title: "Pick one",
    metadata: { kind: "question" },
    fields: [{ key: "choice", type: "string", options: [{ value: "a", label: "A" }] }],
    ...overrides,
  };
}

describe("questionFields", () => {
  it("returns every visible string field of a question form", () => {
    const target = form({
      fields: [
        { key: "first", type: "string", title: "First" },
        { key: "second", type: "string", title: "Second" },
        { key: "secret", type: "string", hidden: true },
      ],
    });
    expect(questionFields(target)?.map((field) => field.key)).toEqual(["first", "second"]);
  });

  it("leaves non-question and mixed forms to the form card", () => {
    expect(questionFields(form({ metadata: { kind: "permission" } }))).toBeNull();
    expect(
      questionFields(
        form({
          fields: [
            { key: "first", type: "string" },
            { key: "count", type: "number" },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("visibleFormFields", () => {
  const stepped = form({
    fields: [
      { key: "first", type: "string", title: "First" },
      {
        key: "second",
        type: "string",
        title: "Second",
        when: [{ key: "first", op: "eq", value: "yes" }],
      },
      { key: "secret", type: "string", hidden: true },
    ],
  });

  it("skips hidden and unmet conditional fields", () => {
    expect(visibleFormFields(stepped, {}).map((field) => field.key)).toEqual(["first"]);
    expect(
      visibleFormFields(stepped, { first: "yes" }).map((field) => field.key),
    ).toEqual(["first", "second"]);
  });

  it("matches the visible filter used for each step", () => {
    const field: FormField = {
      key: "second",
      type: "string",
      when: [{ key: "first", op: "eq", value: "yes" }],
    };
    expect(isFieldVisible(field, { first: "no" })).toBe(false);
    expect(isFieldVisible(field, { first: "yes" })).toBe(true);
  });
});

describe("initialFormValues", () => {
  it("uses defaults and type-specific empty values", () => {
    const values = initialFormValues(
      form({
        fields: [
          { key: "text", type: "string", default: "hello" },
          { key: "flag", type: "boolean" },
          { key: "items", type: "multiselect", options: [] },
        ],
      }),
    );
    expect(values).toEqual({ text: "hello", flag: false, items: [] });
  });
});

describe("isEmptyAnswer", () => {
  it("treats blank strings and empty lists as empty", () => {
    expect(isEmptyAnswer("")).toBe(true);
    expect(isEmptyAnswer([])).toBe(true);
    expect(isEmptyAnswer(undefined)).toBe(true);
    expect(isEmptyAnswer("a")).toBe(false);
    expect(isEmptyAnswer(["a"])).toBe(false);
    expect(isEmptyAnswer(false)).toBe(false);
  });
});

describe("questionAnswer", () => {
  const fields: FormField[] = [
    { key: "first", type: "string" },
    { key: "second", type: "string" },
    { key: "optional", type: "string" },
  ];

  it("keeps answered steps and drops empty optional ones", () => {
    expect(questionAnswer(fields, { first: " yes ", second: "B" })).toEqual({
      first: "yes",
      second: "B",
    });
  });
});
