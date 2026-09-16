export const ThemePreference = {
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const;

export type ThemePreference =
  (typeof ThemePreference)[keyof typeof ThemePreference];

const THEME_STORAGE_KEY = "inspector-ai:theme:v1";
const SYSTEM_DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

let isSystemThemeListenerInitialized = false;

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    value === ThemePreference.SYSTEM ||
    value === ThemePreference.LIGHT ||
    value === ThemePreference.DARK
  );
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return ThemePreference.SYSTEM;
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (isThemePreference(storedTheme)) {
      return storedTheme;
    }

    if (storedTheme !== null) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    return ThemePreference.SYSTEM;
  }

  return ThemePreference.SYSTEM;
}

function getSystemTheme(): Exclude<ThemePreference, "system"> {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SYSTEM_DARK_THEME_QUERY).matches
  ) {
    return ThemePreference.DARK;
  }

  return ThemePreference.LIGHT;
}

function applyResolvedTheme(theme: Exclude<ThemePreference, "system">) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.toggle("dark", theme === ThemePreference.DARK);
  root.classList.toggle("light", theme === ThemePreference.LIGHT);
  root.dataset.theme = theme;
}

export function applyThemePreference(preference: ThemePreference) {
  applyResolvedTheme(
    preference === ThemePreference.SYSTEM ? getSystemTheme() : preference,
  );
}

export function saveThemePreference(preference: ThemePreference) {
  if (typeof window !== "undefined") {
    try {
      if (preference === ThemePreference.SYSTEM) {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      // The selected theme still applies for the current page session.
    }
  }

  applyThemePreference(preference);
}

export function initializeTheme() {
  applyThemePreference(getThemePreference());

  if (
    isSystemThemeListenerInitialized ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return;
  }

  isSystemThemeListenerInitialized = true;
  window
    .matchMedia(SYSTEM_DARK_THEME_QUERY)
    .addEventListener("change", (event) => {
      if (getThemePreference() === ThemePreference.SYSTEM) {
        applyResolvedTheme(
          event.matches ? ThemePreference.DARK : ThemePreference.LIGHT,
        );
      }
    });
}
