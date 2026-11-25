import {
  createThemeStore,
  type ResolvedTheme,
  type ThemeEnvironment,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui";

const noop = (): void => undefined;

const fallbackThemeEnvironment: ThemeEnvironment = {
  storage: () => ({
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
  }),
  darkQuery: {
    matches: false,
    addEventListener: noop,
  },
  root: { dataset: {} },
  onStorage: noop,
};

export function createMailThemeStore(
  environment?: ThemeEnvironment,
): ThemeStore {
  if (environment !== undefined) {
    return createThemeStore("ops-theme", environment);
  }
  return typeof document !== "undefined" &&
    typeof globalThis.matchMedia === "function"
    ? createThemeStore("ops-theme")
    : createThemeStore("ops-theme", fallbackThemeEnvironment);
}

/**
 * Shared theme store persisted under `ops-theme` so Mail stays in sync with
 * Hub, Flags, and Go links across the tailnet consoles.
 */
export const themeStore: ThemeStore = createMailThemeStore();

export function setThemePreference(next: ThemePreference): void {
  themeStore.setThemePreference(next);
}

export function useThemePreference(): ThemePreference {
  return themeStore.useThemePreference();
}

export function useResolvedTheme(): ResolvedTheme {
  return themeStore.useResolvedTheme();
}
