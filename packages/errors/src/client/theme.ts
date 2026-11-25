import {
  createThemeStore,
  type ThemeEnvironment,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui";

const noop = (): void => {
  // Static/non-DOM environments do not subscribe to browser events.
};

function createStaticEnvironment(): ThemeEnvironment {
  const dataset: Record<string, string | undefined> = {};
  return {
    storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset },
    onStorage: noop,
  };
}

function buildDefaultThemeStore(): ThemeStore {
  return typeof document === "undefined" ||
    typeof globalThis.matchMedia !== "function"
    ? createThemeStore("ops-theme", createStaticEnvironment())
    : createThemeStore("ops-theme");
}

export const themeStore: ThemeStore = buildDefaultThemeStore();

export function useThemePreference(
  store: ThemeStore = themeStore,
): ThemePreference {
  return store.useThemePreference();
}
