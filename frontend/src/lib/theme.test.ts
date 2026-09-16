import {
  applyThemePreference,
  getThemePreference,
  initializeTheme,
  saveThemePreference,
  ThemePreference,
} from "./theme";

const storageKey = "inspector-ai:theme:v1";

interface SystemThemeController {
  setMatches: (matches: boolean) => void;
}

function setSystemDarkMode(initialMatches: boolean): SystemThemeController {
  let matches = initialMatches;
  let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
  const mediaQuery = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (type === "change" && typeof listener === "function") {
        changeListener = listener;
      }
    },
    addListener: () => undefined,
    dispatchEvent: () => true,
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  } as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (): MediaQueryList => mediaQuery,
    writable: true,
  });

  return {
    setMatches: (nextMatches) => {
      matches = nextMatches;
      changeListener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe("theme preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    delete document.documentElement.dataset.theme;
    setSystemDarkMode(false);
  });

  it("сохраняет и применяет выбранную тему", () => {
    saveThemePreference(ThemePreference.DARK);

    expect(window.localStorage.getItem(storageKey)).toBe("dark");
    expect(getThemePreference()).toBe(ThemePreference.DARK);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");

    saveThemePreference(ThemePreference.LIGHT);

    expect(window.localStorage.getItem(storageKey)).toBe("light");
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("в системном режиме использует тему операционной системы", () => {
    setSystemDarkMode(true);
    window.localStorage.setItem(storageKey, "light");

    saveThemePreference(ThemePreference.SYSTEM);

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(getThemePreference()).toBe(ThemePreference.SYSTEM);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("сбрасывает неизвестное сохранённое значение", () => {
    window.localStorage.setItem(storageKey, "contrast");

    expect(getThemePreference()).toBe(ThemePreference.SYSTEM);
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    applyThemePreference(ThemePreference.SYSTEM);
    expect(document.documentElement).toHaveClass("light");
  });

  it("обновляет системную тему при изменении настройки ОС", () => {
    const systemTheme = setSystemDarkMode(false);
    saveThemePreference(ThemePreference.SYSTEM);
    initializeTheme();

    expect(document.documentElement).toHaveClass("light");

    systemTheme.setMatches(true);
    expect(document.documentElement).toHaveClass("dark");

    saveThemePreference(ThemePreference.LIGHT);
    systemTheme.setMatches(true);
    expect(document.documentElement).toHaveClass("light");
  });
});
