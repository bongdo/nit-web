import { describe, expect, it } from "vitest";
import { isEditableTarget, shouldCaptureKey, type KeyEvent } from "./keys";

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
