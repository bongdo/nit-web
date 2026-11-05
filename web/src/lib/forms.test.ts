import { describe, expect, it } from "vitest";
import { questionField } from "./forms";
import type { FormInfo } from "./types";

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

describe("questionField", () => {
  it("returns the single string field of a question form", () => {
    const field = questionField(form());
    expect(field?.key).toBe("choice");
  });

  it("ignores non-question forms", () => {
    expect(questionField(form({ metadata: { kind: "permission" } }))).toBeNull();
  });

  it("ignores hidden fields", () => {
    const target = form({
      fields: [
        { key: "choice", type: "string" },
        { key: "secret", type: "string", hidden: true },
      ],
    });
    expect(questionField(target)?.key).toBe("choice");
  });

  it("falls back when a question has several fields", () => {
    const target = form({
      fields: [
        { key: "first", type: "string" },
        { key: "second", type: "string" },
      ],
    });
    expect(questionField(target)).toBeNull();
  });

  it("falls back for non-string questions", () => {
    const target = form({ fields: [{ key: "count", type: "number" }] });
    expect(questionField(target)).toBeNull();
  });
});
