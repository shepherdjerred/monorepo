import { z } from "zod";
import { scoutThemes } from "#src/generated/tokens.ts";

export const SCOUT_THEME_STORAGE_KEY = "scout-theme-v1";
export const SCOUT_LEGACY_APP_THEME_KEY = "scout-app-theme";
export const SCOUT_LEGACY_MARKETING_THEME_KEY = "theme";

export const ScoutSkinSchema = z.enum(["classic", "modern"]);
export const ScoutModePreferenceSchema = z.enum(["system", "light", "dark"]);
export const ScoutResolvedModeSchema = z.enum(["light", "dark"]);
export const ScoutThemePreferenceV1Schema = z.object({
  version: z.literal(1),
  skin: ScoutSkinSchema,
  mode: ScoutModePreferenceSchema,
});

export type ScoutSkin = z.infer<typeof ScoutSkinSchema>;
export type ScoutModePreference = z.infer<typeof ScoutModePreferenceSchema>;
export type ScoutResolvedMode = z.infer<typeof ScoutResolvedModeSchema>;
export type ScoutThemePreferenceV1 = z.infer<
  typeof ScoutThemePreferenceV1Schema
>;
export type ScoutResolvedTheme =
  "classic-light" | "classic-dark" | "modern-light" | "modern-dark";

export const DEFAULT_SCOUT_THEME_PREFERENCE: ScoutThemePreferenceV1 = {
  version: 1,
  skin: "modern",
  mode: "system",
};

export function resolveScoutMode(
  mode: ScoutModePreference,
  systemPrefersDark: boolean,
): ScoutResolvedMode {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function resolveScoutTheme(
  preference: ScoutThemePreferenceV1,
  systemPrefersDark: boolean,
): ScoutResolvedTheme {
  return `${preference.skin}-${resolveScoutMode(preference.mode, systemPrefersDark)}`;
}

export function scoutThemeCanvas(theme: ScoutResolvedTheme): string {
  return scoutThemes[theme].colors.canvas;
}

export function writeScoutThemeColor(document: Document, color: string): void {
  const existing = document.querySelector('meta[name="theme-color"]');
  if (existing !== null) {
    existing.setAttribute("content", color);
    return;
  }
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", color);
  document.head.append(meta);
}

export function applyScoutTheme(
  root: HTMLElement,
  preference: ScoutThemePreferenceV1,
  systemPrefersDark: boolean,
): ScoutResolvedMode {
  const resolvedMode = resolveScoutMode(preference.mode, systemPrefersDark);
  const theme = resolveScoutTheme(preference, systemPrefersDark);
  root.dataset["scoutSkin"] = preference.skin;
  root.dataset["scoutMode"] = resolvedMode;
  root.dataset["theme"] = resolvedMode;
  root.classList.toggle("dark", resolvedMode === "dark");
  writeScoutThemeColor(root.ownerDocument, scoutThemeCanvas(theme));
  return resolvedMode;
}

function readLegacyMode(storage: Storage): ScoutModePreference | undefined {
  for (const key of [
    SCOUT_LEGACY_APP_THEME_KEY,
    SCOUT_LEGACY_MARKETING_THEME_KEY,
  ]) {
    const value = storage.getItem(key);
    const parsed = ScoutModePreferenceSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
}

export function readScoutThemePreference(
  storage: Storage,
): ScoutThemePreferenceV1 {
  const current = storage.getItem(SCOUT_THEME_STORAGE_KEY);
  if (current !== null) {
    try {
      const parsed = ScoutThemePreferenceV1Schema.safeParse(
        JSON.parse(current),
      );
      if (parsed.success) {
        return parsed.data;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }

  const legacyMode = readLegacyMode(storage);
  if (legacyMode === undefined) {
    return DEFAULT_SCOUT_THEME_PREFERENCE;
  }
  const migrated: ScoutThemePreferenceV1 = {
    version: 1,
    skin: "modern",
    mode: legacyMode,
  };
  storage.setItem(SCOUT_THEME_STORAGE_KEY, JSON.stringify(migrated));
  storage.removeItem(SCOUT_LEGACY_APP_THEME_KEY);
  storage.removeItem(SCOUT_LEGACY_MARKETING_THEME_KEY);
  return migrated;
}

export function readScoutThemePreferenceOrDefault(
  storage: Storage,
): ScoutThemePreferenceV1 {
  try {
    return readScoutThemePreference(storage);
  } catch {
    return DEFAULT_SCOUT_THEME_PREFERENCE;
  }
}

export function writeScoutThemePreference(
  storage: Storage,
  preference: ScoutThemePreferenceV1,
): void {
  storage.setItem(SCOUT_THEME_STORAGE_KEY, JSON.stringify(preference));
}
