type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;

export type DraftState = { text: string; updatedAt: number };

export function draftStorageKey(key: string): string {
  return `nit-gui.draft.${key}`;
}

export function draftUpdatedKey(key: string): string {
  return `${draftStorageKey(key)}.updated`;
}

export function loadDraftState(key: string, storage: ReadStorage = localStorage): DraftState {
  try {
    const text = storage.getItem(draftStorageKey(key)) ?? "";
    const raw = storage.getItem(draftUpdatedKey(key));
    const value = raw ? Number(raw) : 0;
    return { text, updatedAt: Number.isFinite(value) ? value : 0 };
  } catch {
    return { text: "", updatedAt: 0 };
  }
}

export function saveDraftState(
  key: string,
  text: string,
  updatedAt = Date.now(),
  storage: WriteStorage = localStorage,
): void {
  try {
    if (text) {
      storage.setItem(draftStorageKey(key), text);
      storage.setItem(draftUpdatedKey(key), String(updatedAt));
    } else {
      storage.removeItem(draftStorageKey(key));
      storage.removeItem(draftUpdatedKey(key));
    }
  } catch {}
}

export function loadDraft(key: string, storage: ReadStorage = localStorage): string {
  return loadDraftState(key, storage).text;
}

export function saveDraft(key: string, value: string, storage: WriteStorage = localStorage): void {
  saveDraftState(key, value, Date.now(), storage);
}
