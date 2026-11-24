import { createThemeStore } from "@shepherdjerred/console-ui";

/** The stored choice; console-ui's `ThemePreference` has the same members. */
export type ThemePreference = "system" | "light" | "dark";
/** The theme on screen; console-ui's `ResolvedTheme`. */
export type Theme = "light" | "dark";

/**
 * Hub's theme preference, shared with the other consoles' store shape. The
 * key predates the shared package; a stored `"system"` (written by the old
 * store) still reads as system, and choosing system now removes the key.
 */
export const themeStore = createThemeStore("ops-theme");

export function setThemePreference(next: ThemePreference): void {
  themeStore.setThemePreference(next);
}

export function useThemePreference(): ThemePreference {
  return themeStore.useThemePreference();
}

/** The theme actually on screen, following the OS when set to system. */
export function useResolvedTheme(): Theme {
  return themeStore.useResolvedTheme();
}
