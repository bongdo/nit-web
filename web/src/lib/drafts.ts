type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;

export function draftStorageKey(key: string): string {
  return `nit-gui.draft.${key}`;
}

export function loadDraft(key: string, storage: ReadStorage = localStorage): string {
  try {
    return storage.getItem(draftStorageKey(key)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(key: string, value: string, storage: WriteStorage = localStorage): void {
  try {
    const storageKey = draftStorageKey(key);
    if (value) storage.setItem(storageKey, value);
    else storage.removeItem(storageKey);
  } catch {}
}
