import type { FormField, FormInfo } from "./types";

export function questionField(form: FormInfo): FormField | null {
  if (form.metadata?.kind !== "question") return null;
  const fields = form.fields.filter((field) => !field.hidden);
  if (fields.length !== 1 || fields[0].type !== "string") return null;
  return fields[0];
}

export function initialFormValues(form: FormInfo): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.default !== undefined) values[field.key] = field.default;
    else if (field.type === "boolean") values[field.key] = false;
    else if (field.type === "multiselect") values[field.key] = [];
    else values[field.key] = "";
  }
  return values;
}

export function isFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  if (field.hidden) return false;
  if (!field.when || field.when.length === 0) return true;
  return field.when.every((condition) => {
    const value = values[condition.key];
    return condition.op === "eq" ? value === condition.value : value !== condition.value;
  });
}

export function visibleFormFields(
  form: FormInfo,
  values: Record<string, unknown>,
): FormField[] {
  return form.fields.filter((field) => isFieldVisible(field, values));
}

export function isEmptyAnswer(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
