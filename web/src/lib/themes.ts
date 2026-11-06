export const THEMES = [
  { id: "system", label: "System", hint: "auto" },
  { id: "light", label: "Stock light", hint: "light" },
  { id: "dark", label: "Stock dark", hint: "dark" },
  { id: "nord", label: "Nord", hint: "dark" },
  { id: "solarized", label: "Solarized Light", hint: "light" },
  { id: "gruvbox", label: "Gruvbox", hint: "dark" },
  { id: "dracula", label: "Dracula", hint: "dark" },
  { id: "paper", label: "Paper", hint: "light" },
  { id: "ember", label: "Ember", hint: "dark" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export function themeIsDark(theme: Theme, prefersDark: boolean): boolean {
  if (theme === "system") return prefersDark;
  return THEMES.find((item) => item.id === theme)?.hint === "dark";
}

export function themeLabel(theme: Theme): string {
  return THEMES.find((item) => item.id === theme)?.label ?? theme;
}
