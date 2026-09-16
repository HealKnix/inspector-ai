import { type Key, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useState } from "react";

import {
  getThemePreference,
  isThemePreference,
  saveThemePreference,
  ThemePreference,
} from "@/lib/theme";

const themeOptions = [
  { label: "Система", value: ThemePreference.SYSTEM },
  { label: "Светлая", value: ThemePreference.LIGHT },
  { label: "Тёмная", value: ThemePreference.DARK },
] as const;

export function ThemeSwitcher() {
  const [preference, setPreference] = useState(getThemePreference);

  const handleSelectionChange = (keys: Set<Key>) => {
    const selectedTheme = keys.values().next().value;

    if (!isThemePreference(selectedTheme)) {
      return;
    }

    setPreference(selectedTheme);
    saveThemePreference(selectedTheme);
  };

  return (
    <ToggleButtonGroup
      aria-label="Тема оформления"
      className="mt-2 w-full gap-1 p-1"
      disallowEmptySelection
      fullWidth
      isDetached
      onSelectionChange={handleSelectionChange}
      selectedKeys={new Set<Key>([preference])}
      selectionMode="single"
      size="sm"
    >
      {themeOptions.map((option) => (
        <ToggleButton id={option.value} key={option.value} variant="ghost">
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
