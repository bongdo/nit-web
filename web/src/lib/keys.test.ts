import { describe, expect, it } from "vitest";
import { isEditableTarget, shouldCaptureKey, shortcutKeys, type KeyEvent } from "./keys";

const key = (value: string, overrides: Partial<KeyEvent> = {}): KeyEvent => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

const target = (kind: "editable" | "action" | "plain") => ({
  closest: (selector: string) =>
    (kind === "editable" && selector.includes("textarea")) ||
    (kind === "action" && selector.includes("button"))
      ? {}
      : null,
});

describe("shortcutKeys", () => {
  it("reads the letter from the physical code", () => {
    expect(shortcutKeys({ key: "n", code: "KeyN" })).toEqual(["n"]);
    expect(shortcutKeys({ key: "N", code: "KeyN" })).toEqual(["n"]);
  });

  it("keeps a hotkey working on the russian layout", () => {
    expect(shortcutKeys({ key: "т", code: "KeyN" })).toContain("n");
    expect(shortcutKeys({ key: "Т", code: "KeyN" })).toContain("n");
    expect(shortcutKeys({ key: "л", code: "KeyK" })).toContain("k");
    expect(shortcutKeys({ key: "о", code: "KeyJ" })).toContain("j");
    expect(shortcutKeys({ key: "щ", code: "KeyO" })).toContain("o");
    expect(shortcutKeys({ key: "я", code: "KeyZ" })).toContain("z");
  });

  it("falls back to the russian letter when the code is missing or phonetic", () => {
    expect(shortcutKeys({ key: "т" })).toContain("n");
    expect(shortcutKeys({ key: "т", code: "KeyT" })).toContain("n");
    expect(shortcutKeys({ key: "н", code: "KeyN" })).toContain("n");
    expect(shortcutKeys({ key: "й", code: "KeyQ" })).toContain("q");
    expect(shortcutKeys({ key: "ь", code: "KeyM" })).toContain("m");
  });

  it("ignores non-letter keys", () => {
    expect(shortcutKeys({ key: "Enter", code: "Enter" })).toEqual([]);
    expect(shortcutKeys({ key: " ", code: "Space" })).toEqual([]);
    expect(shortcutKeys({ key: "Escape" })).toEqual([]);
  });
});

describe("shouldCaptureKey", () => {
  it("captures a printable key typed outside a field", () => {
    expect(shouldCaptureKey(key("a"), target("plain"), false)).toBe(true);
    expect(shouldCaptureKey(key(" "), target("plain"), false)).toBe(true);
  });

  it("ignores shortcuts, composition and non-printable keys", () => {
    expect(shouldCaptureKey(key("a", { ctrlKey: true }), target("plain"), false)).toBe(false);
    expect(shouldCaptureKey(key("a", { metaKey: true }), target("plain"), false)).toBe(false);
    expect(shouldCaptureKey(key("a", { altKey: true }), target("plain"), false)).toBe(false);
    expect(shouldCaptureKey(key("a", { isComposing: true }), target("plain"), false)).toBe(false);
    expect(shouldCaptureKey(key("Enter"), target("plain"), false)).toBe(false);
    expect(shouldCaptureKey(key("a", { defaultPrevented: true }), target("plain"), false)).toBe(
      false,
    );
  });

  it("leaves a focused field alone", () => {
    expect(shouldCaptureKey(key("a"), target("editable"), false)).toBe(false);
    expect(shouldCaptureKey(key(" "), target("editable"), false)).toBe(false);
  });

  it("does not steal space from a focused control", () => {
    expect(shouldCaptureKey(key(" "), target("action"), false)).toBe(false);
    expect(shouldCaptureKey(key("a"), target("action"), false)).toBe(true);
  });

  it("stays out of the way while an overlay is open", () => {
    expect(shouldCaptureKey(key("a"), target("plain"), true)).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("treats text fields as editable and everything else as not", () => {
    expect(isEditableTarget(target("editable"))).toBe(true);
    expect(isEditableTarget(target("plain"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
