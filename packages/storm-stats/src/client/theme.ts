import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "storm-stats-color-scheme";

export type ColorScheme = "light" | "dark";
export type MetaColorScheme = "light" | "dark" | "light dark";

export type ToggleOutcome = {
  readonly nextStored: ColorScheme | null;
  readonly metaContent: MetaColorScheme;
  readonly activeScheme: ColorScheme;
};

export type ThemeSnapshot = {
  readonly stored: ColorScheme | null;
  readonly systemPrefersDark: boolean;
  readonly activeScheme: ColorScheme;
};

export function parseStoredScheme(raw: string | null): ColorScheme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

export function resolveActiveScheme(
  stored: ColorScheme | null,
  systemPrefersDark: boolean,
): ColorScheme {
  return stored ?? (systemPrefersDark ? "dark" : "light");
}

export function computeToggleOutcome(
  stored: ColorScheme | null,
  systemPrefersDark: boolean,
): ToggleOutcome {
  const currentActive = resolveActiveScheme(stored, systemPrefersDark);
  const target: ColorScheme = currentActive === "dark" ? "light" : "dark";
  const systemScheme: ColorScheme = systemPrefersDark ? "dark" : "light";

  if (target === systemScheme) {
    return {
      nextStored: null,
      metaContent: "light dark",
      activeScheme: target,
    };
  }

  return {
    nextStored: target,
    metaContent: target,
    activeScheme: target,
  };
}

function getColorSchemeMediaQuery(): MediaQueryList | null {
  return "matchMedia" in globalThis
    ? globalThis.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

function readSystemPrefersDark(): boolean {
  return getColorSchemeMediaQuery()?.matches ?? false;
}

function readStoredFromBrowser(): ColorScheme | null {
  try {
    return "localStorage" in globalThis
      ? parseStoredScheme(globalThis.localStorage.getItem(THEME_STORAGE_KEY))
      : null;
  } catch {
    return null;
  }
}

function writeMetaColorScheme(content: MetaColorScheme): void {
  if (!("document" in globalThis)) {
    return;
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta !== null) {
    meta.setAttribute("content", content);
  }
}

const listeners = new Set<() => void>();
let initialized = false;
let currentSnapshot: ThemeSnapshot = {
  stored: null,
  systemPrefersDark: false,
  activeScheme: "light",
};

function refreshSnapshot(): void {
  const stored = readStoredFromBrowser();
  const systemPrefersDark = readSystemPrefersDark();
  const activeScheme = resolveActiveScheme(stored, systemPrefersDark);
  if (
    currentSnapshot.stored === stored &&
    currentSnapshot.systemPrefersDark === systemPrefersDark &&
    currentSnapshot.activeScheme === activeScheme
  ) {
    return;
  }
  currentSnapshot = { stored, systemPrefersDark, activeScheme };
  for (const listener of listeners) {
    listener();
  }
}

function ensureThemeListeners(): void {
  if (initialized || !("addEventListener" in globalThis)) {
    return;
  }
  initialized = true;
  const stored = readStoredFromBrowser();
  const systemPrefersDark = readSystemPrefersDark();
  currentSnapshot = {
    stored,
    systemPrefersDark,
    activeScheme: resolveActiveScheme(stored, systemPrefersDark),
  };
  writeMetaColorScheme(stored ?? "light dark");

  globalThis.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
      return;
    }
    const updatedStored = readStoredFromBrowser();
    writeMetaColorScheme(updatedStored ?? "light dark");
    refreshSnapshot();
  });

  const mediaQuery = getColorSchemeMediaQuery();
  if (mediaQuery !== null) {
    mediaQuery.addEventListener("change", () => {
      // Never delete a stored override when the OS preference changes
      refreshSnapshot();
    });
  }
}

function subscribeTheme(listener: () => void): () => void {
  ensureThemeListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getThemeSnapshot(): ThemeSnapshot {
  ensureThemeListeners();
  return currentSnapshot;
}

const SERVER_SNAPSHOT: ThemeSnapshot = {
  stored: null,
  systemPrefersDark: false,
  activeScheme: "light",
};

function getServerSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

export function toggleColorScheme(): ToggleOutcome {
  ensureThemeListeners();
  const outcome = computeToggleOutcome(
    currentSnapshot.stored,
    readSystemPrefersDark(),
  );
  try {
    if (outcome.nextStored === null) {
      globalThis.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, outcome.nextStored);
    }
  } catch {
    // Still apply to page meta and in-memory snapshot even if storage is blocked
  }
  writeMetaColorScheme(outcome.metaContent);
  currentSnapshot = {
    stored: outcome.nextStored,
    systemPrefersDark: readSystemPrefersDark(),
    activeScheme: outcome.activeScheme,
  };
  for (const listener of listeners) {
    listener();
  }
  return outcome;
}

export function useColorScheme(): ThemeSnapshot {
  return useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerSnapshot,
  );
}
