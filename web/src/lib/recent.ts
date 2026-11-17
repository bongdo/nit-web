import { instanceScopedKey } from "./instances";

const LIMIT = 8;

export function readRecent(instance: string, defaultInstance: string): string[] {
  if (!instance) return [];
  try {
    const raw = localStorage.getItem(instanceScopedKey("nit-gui.recent", instance, defaultInstance));
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function addRecent(
  instance: string,
  defaultInstance: string,
  directory: string,
): string[] {
  const value = directory.trim().replace(/\/+$/, "") || "/";
  const next = [value, ...readRecent(instance, defaultInstance).filter((item) => item !== value)];
  const list = next.slice(0, LIMIT);
  try {
    localStorage.setItem(
      instanceScopedKey("nit-gui.recent", instance, defaultInstance),
      JSON.stringify(list),
    );
  } catch {}
  return list;
}
