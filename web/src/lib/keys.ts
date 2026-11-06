type KeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
};

type KeyTarget = { closest: (selector: string) => unknown } | null;

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='searchbox'], [role='combobox']";
const SPACE_ACTIONS =
  "button, a[href], summary, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='option'], [role='tab']";

export function shouldCaptureKey(event: KeyEvent, target: KeyTarget, blocked: boolean): boolean {
  if (blocked || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing || event.key.length !== 1) return false;
  if (target?.closest(EDITABLE)) return false;
  if (event.key === " " && target?.closest(SPACE_ACTIONS)) return false;
  return true;
}
