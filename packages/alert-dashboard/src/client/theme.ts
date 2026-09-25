import { useSyncExternalStore } from "react";
import { z } from "zod";

export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;
export type Theme = "light" | "dark";

const STORAGE_KEY = "ops-theme";
const listeners = new Set<() => void>();
const darkQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");

function readPreference(): ThemePreference {
  try {
    const parsed = ThemePreferenceSchema.safeParse(
      globalThis.localStorage.getItem(STORAGE_KEY),
    );
    return parsed.success ? parsed.data : "system";
  } catch {
    return "system";
  }
}

let preference = readPreference();

function apply(): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = preference;
}
apply();

function notify(): void {
  for (const listener of listeners) listener();
}
darkQuery.addEventListener("change", notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies
    // for this page view.
  }
  apply();
  notify();
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference);
}

/** The theme actually on screen, following the OS when set to system. */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, () => {
    if (preference !== "system") return preference;
    return darkQuery.matches ? "dark" : "light";
  });
}
