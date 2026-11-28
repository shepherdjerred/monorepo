import { useSyncExternalStore } from "react";
import { tokens } from "@shepherdjerred/console-ui/tokens.ts";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

/**
 * The one storage key every console shares, so choosing a theme in one
 * console carries to the others on the same host.
 */
export const THEME_STORAGE_KEY = "ops-theme";

/** Anything other than an explicit light or dark choice follows the OS. */
export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The preference after `current` in the system → light → dark cycle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? "system";
}

/** A `<meta name="theme-color">`; `media` is empty when it has none. */
export type ThemeColorMeta = { content: string; readonly media: string };

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
  /** The page's `theme-color` metas, kept equal to the `bg` token on screen. */
  readonly themeColorMetas?: () => Iterable<ThemeColorMeta>;
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

function noop(): void {
  // Nothing to listen to without a browser.
}

/**
 * No DOM (server rendering, unit tests without jsdom): the preference lives
 * in memory and the OS reads as light.
 */
function headlessEnvironment(): ThemeEnvironment {
  return {
    storage: () => ({
      getItem: () => null,
      setItem: noop,
      removeItem: noop,
    }),
    darkQuery: { matches: false, addEventListener: noop },
    root: { dataset: {} },
    onStorage: noop,
  };
}

function browserEnvironment(): ThemeEnvironment {
  if (
    !("document" in globalThis) ||
    typeof globalThis.matchMedia !== "function"
  ) {
    return headlessEnvironment();
  }
  return {
    storage: () => globalThis.localStorage,
    darkQuery: globalThis.matchMedia("(prefers-color-scheme: dark)"),
    root: document.documentElement,
    onStorage: (listener) => {
      globalThis.addEventListener("storage", (event) => {
        if (event instanceof StorageEvent) listener(event.key, event.newValue);
      });
    },
    themeColorMetas: () =>
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  };
}

/** The colour a `theme-color` meta should carry for this preference. */
function themeColor(
  meta: ThemeColorMeta,
  preference: ThemePreference,
  resolved: ResolvedTheme,
): string {
  const scheme = meta.media.includes("dark") ? "dark" : "light";
  const follows = preference === "system" && meta.media.includes(scheme);
  return tokens[follows ? scheme : resolved].bg;
}

/**
 * A theme preference persisted under `storageKey` (every console uses the
 * default, `ops-theme`) and reflected as `html[data-theme]`. `system`
 * removes the attribute, so the stylesheet's `prefers-color-scheme` rule
 * decides. The page's `theme-color` metas follow the `bg` token on screen.
 * Storage failures (private mode, blocked site data) are tolerated, and
 * without a DOM the store keeps the preference in memory.
 */
export function createThemeStore(
  storageKey: string = THEME_STORAGE_KEY,
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

  const getResolvedTheme = (): ResolvedTheme => {
    if (preference !== "system") return preference;
    return environment.darkQuery.matches ? "dark" : "light";
  };

  function apply(): void {
    if (preference === "system") delete environment.root.dataset["theme"];
    else environment.root.dataset["theme"] = preference;
    const resolved = getResolvedTheme();
    for (const meta of environment.themeColorMetas?.() ?? []) {
      meta.content = themeColor(meta, preference, resolved);
    }
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
  environment.darkQuery.addEventListener("change", () => {
    apply();
    notify();
  });
  environment.onStorage((key, value) => {
    if (key !== storageKey) return;
    preference = parseThemePreference(value);
    apply();
    notify();
  });

  const getPreference = (): ThemePreference => preference;
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
