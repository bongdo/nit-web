import { useCallback, useEffect, useState } from "react";
import { THEMES, themeIsDark, type Theme } from "../lib/themes";

export type { Theme } from "../lib/themes";

const STORAGE_KEY = "nit-gui.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((item) => item.id === value) ? (value as Theme) : "system";
}

function applyTheme(theme: Theme) {
  const dark = themeIsDark(theme, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme =
    theme === "system" ? (dark ? "dark" : "light") : theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, setTheme };
}
