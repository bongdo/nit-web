import { describe, expect, it } from "vitest";
import {
  draftStorageKey,
  draftUpdatedKey,
  loadDraft,
  loadDraftState,
  saveDraft,
  saveDraftState,
} from "./drafts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    has: (key: string) => values.has(key),
  };
}

describe("drafts", () => {
  it("keeps a separate draft per key", () => {
    const storage = memoryStorage();
    saveDraft("ses_a", "first", storage);
    saveDraft("ses_b", "second", storage);
    expect(loadDraft("ses_a", storage)).toBe("first");
    expect(loadDraft("ses_b", storage)).toBe("second");
    expect(storage.has(draftStorageKey("ses_a"))).toBe(true);
  });

  it("removes empty drafts", () => {
    const storage = memoryStorage();
    saveDraft("ses_a", "text", storage);
    saveDraft("ses_a", "", storage);
    expect(loadDraft("ses_a", storage)).toBe("");
    expect(storage.has(draftStorageKey("ses_a"))).toBe(false);
    expect(storage.has(draftUpdatedKey("ses_a"))).toBe(false);
  });

  it("keeps the local timestamp for server conflict resolution", () => {
    const storage = memoryStorage();
    saveDraftState("ses_a", "long prompt", 1234, storage);
    expect(loadDraftState("ses_a", storage)).toEqual({
      text: "long prompt",
      updatedAt: 1234,
    });
  });
});
