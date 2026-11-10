export type KeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
};

export type KeyTarget = { closest: (selector: string) => unknown } | null;

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='searchbox'], [role='combobox']";
const SPACE_ACTIONS =
  "button, a[href], summary, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='option'], [role='tab']";

const LATIN_KEYS = "qwertyuiopasdfghjklzxcvbnm";
const CYRILLIC_KEYS = "йцукенгшщзфывапролдячсмить";

export function shortcutKeys(event: { key: string; code?: string }): string[] {
  const keys = new Set<string>();
  if (event.code?.startsWith("Key")) keys.add(event.code.slice(3).toLowerCase());
  const key = event.key.toLowerCase();
  if (key.length === 1 && key >= "a" && key <= "z") keys.add(key);
  const index = CYRILLIC_KEYS.indexOf(key);
  if (index !== -1) keys.add(LATIN_KEYS[index] as string);
  return [...keys];
}

export function isEditableTarget(target: KeyTarget): boolean {
  return Boolean(target?.closest(EDITABLE));
}

export function shouldCaptureKey(event: KeyEvent, target: KeyTarget, blocked: boolean): boolean {
  if (blocked || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing || event.key.length !== 1) return false;
  if (isEditableTarget(target)) return false;
  if (event.key === " " && target?.closest(SPACE_ACTIONS)) return false;
  return true;
}
