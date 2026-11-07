import { describe, expect, it } from "vitest";
import { dictationText } from "./web-speech";

describe("dictationText", () => {
  it("appends spoken and interim text with single spaces", () => {
    expect(dictationText("", "привет", "")).toBe("привет");
    expect(dictationText("", "привет", "как")).toBe("привет как");
    expect(dictationText("уже есть", "привет", "")).toBe("уже есть привет");
  });

  it("keeps a trailing space in the draft and drops blank parts", () => {
    expect(dictationText("уже ", "привет", "")).toBe("уже привет");
    expect(dictationText("", "  ", "как  ")).toBe("как");
    expect(dictationText("", "", "")).toBe("");
  });
});
