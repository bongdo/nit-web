import { describe, expect, it } from "vitest";
import {
  draftStorageKey,
  draftUpdatedKey,
  loadDraftState,
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
    saveDraftState("ses_a", "first", 0, storage);
    saveDraftState("ses_b", "second", 0, storage);
    expect(loadDraftState("ses_a", storage).text).toBe("first");
    expect(loadDraftState("ses_b", storage).text).toBe("second");
    expect(storage.has(draftStorageKey("ses_a"))).toBe(true);
  });

  it("removes empty drafts", () => {
    const storage = memoryStorage();
    saveDraftState("ses_a", "text", 0, storage);
    saveDraftState("ses_a", "", 0, storage);
    expect(loadDraftState("ses_a", storage).text).toBe("");
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
