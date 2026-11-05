import type { FormField, FormInfo } from "./types";

export function questionField(form: FormInfo): FormField | null {
  if (form.metadata?.kind !== "question") return null;
  const fields = form.fields.filter((field) => !field.hidden);
  if (fields.length !== 1 || fields[0].type !== "string") return null;
  return fields[0];
}
