import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

/** Anything other than an explicit light or dark choice follows the OS. */
export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The preference after `current` in the system → light → dark cycle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? "system";
}

/** The browser surfaces the store touches; tests pass fakes. */
export type ThemeEnvironment = {
  /** Called on every access because reading `localStorage` itself can throw. */
  readonly storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly darkQuery: {
    readonly matches: boolean;
    addEventListener: (type: "change", listener: () => void) => void;
  };
  readonly root: { readonly dataset: DOMStringMap };
  /** Reports another tab writing a storage key. */
  readonly onStorage: (
    listener: (key: string | null, value: string | null) => void,
  ) => void;
};

export type ThemeStore = {
  readonly getPreference: () => ThemePreference;
  readonly getResolvedTheme: () => ResolvedTheme;
  readonly setThemePreference: (next: ThemePreference) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly useThemePreference: () => ThemePreference;
  /** The theme actually on screen, following the OS when set to system. */
  readonly useResolvedTheme: () => ResolvedTheme;
};

function browserEnvironment(): ThemeEnvironment {
  return {
    storage: () => globalThis.localStorage,
    darkQuery: globalThis.matchMedia("(prefers-color-scheme: dark)"),
    root: document.documentElement,
    onStorage: (listener) => {
      globalThis.addEventListener("storage", (event) => {
        if (event instanceof StorageEvent) listener(event.key, event.newValue);
      });
    },
  };
}

/**
 * A theme preference persisted under `storageKey` and reflected as
 * `html[data-theme]`. `system` removes the attribute, so the stylesheet's
 * `prefers-color-scheme` rule decides. Storage failures (private mode,
 * blocked site data) are tolerated: the choice still applies to this page.
 */
export function createThemeStore(
  storageKey: string,
  environment: ThemeEnvironment = browserEnvironment(),
): ThemeStore {
  const listeners = new Set<() => void>();

  function read(): ThemePreference {
    try {
      return parseThemePreference(environment.storage().getItem(storageKey));
    } catch {
      return "system";
    }
  }

  let preference = read();

  function apply(): void {
    if (preference === "system") delete environment.root.dataset["theme"];
    else environment.root.dataset["theme"] = preference;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function persist(next: ThemePreference): void {
    try {
      const storage = environment.storage();
      if (next === "system") storage.removeItem(storageKey);
      else storage.setItem(storageKey, next);
    } catch {
      // Storage can be unavailable; the choice still applies to this page.
    }
  }

  apply();
  environment.darkQuery.addEventListener("change", notify);
  environment.onStorage((key, value) => {
    if (key !== storageKey) return;
    preference = parseThemePreference(value);
    apply();
    notify();
  });

  const getPreference = (): ThemePreference => preference;
  const getResolvedTheme = (): ResolvedTheme => {
    if (preference !== "system") return preference;
    return environment.darkQuery.matches ? "dark" : "light";
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    getPreference,
    getResolvedTheme,
    setThemePreference(next) {
      preference = next;
      persist(next);
      apply();
      notify();
    },
    subscribe,
    useThemePreference: () =>
      useSyncExternalStore(subscribe, getPreference, getPreference),
    useResolvedTheme: () =>
      useSyncExternalStore(subscribe, getResolvedTheme, getResolvedTheme),
  };
}
