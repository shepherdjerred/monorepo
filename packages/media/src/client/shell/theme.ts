import { useSyncExternalStore } from "react";

/**
 * The theme override. "system" follows the device; "light" and "dark" pin a
 * theme by setting `data-theme` on the root, which is the only hook the
 * down-leveled tokens respond to (see `styles/tokens.css`).
 *
 * The choice is kept in localStorage. Storage can throw (blocked site data,
 * private windows); the choice then lasts for the page's lifetime only.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "media.theme";

type Pinned = Exclude<ThemeChoice, "system">;

let choice: ThemeChoice = "system";
/** Each scheme's `theme-color` meta and the canvas color it announces. */
let announced: Record<
  Pinned,
  { meta: HTMLMetaElement; canvas: string }
> | null = null;
const listeners = new Set<() => void>();

/** Anything other than a pinned theme, including no value, follows the device. */
function parseThemeChoice(value: string | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

function readStored(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function themeColorMeta(scheme: Pinned) {
  const meta = document.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
  );
  if (meta === null) {
    throw new Error(`index.html announces no ${scheme} theme color`);
  }
  return { meta, canvas: meta.content };
}

function apply(next: ThemeChoice) {
  if (announced === null) {
    throw new Error("The theme was used before initializeTheme()");
  }
  const root = document.documentElement;
  if (next === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = next;
  // A pinned theme paints the same canvas whatever the device prefers, so
  // both metas announce it.
  announced.light.meta.content =
    announced[next === "dark" ? "dark" : "light"].canvas;
  announced.dark.meta.content =
    announced[next === "light" ? "light" : "dark"].canvas;
}

function publish(next: ThemeChoice) {
  choice = next;
  apply(next);
  for (const listener of listeners) listener();
}

/**
 * Applies the stored choice. `main.tsx` calls this before the first render,
 * from the module script: the page carries no inline script.
 */
export function initializeTheme() {
  announced = { light: themeColorMeta("light"), dark: themeColorMeta("dark") };
  publish(readStored());
  // Another tab changed or cleared the choice. The event says which key
  // changed, but re-reading is simpler and also covers cleared site data.
  globalThis.addEventListener("storage", () => {
    const stored = readStored();
    if (stored !== choice) publish(stored);
  });
}

export function chooseTheme(next: ThemeChoice) {
  publish(next);
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The choice still applies to this page; it cannot be remembered.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => choice;

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, current, current);
}
