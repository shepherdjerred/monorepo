import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SCOUT_THEME_PREFERENCE,
  readScoutThemePreference,
  readScoutThemePreferenceOrDefault,
  resolveScoutMode,
  resolveScoutTheme,
  SCOUT_LEGACY_APP_THEME_KEY,
  SCOUT_LEGACY_MARKETING_THEME_KEY,
  SCOUT_THEME_STORAGE_KEY,
} from "./theme.ts";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("Scout theme preference", () => {
  test("defaults new visitors to Modern with system appearance", () => {
    expect(readScoutThemePreference(new MemoryStorage())).toEqual(
      DEFAULT_SCOUT_THEME_PREFERENCE,
    );
  });

  test("canonical state wins over both legacy keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SCOUT_THEME_STORAGE_KEY,
      JSON.stringify({ version: 1, skin: "classic", mode: "dark" }),
    );
    storage.setItem(SCOUT_LEGACY_APP_THEME_KEY, "light");
    storage.setItem(SCOUT_LEGACY_MARKETING_THEME_KEY, "system");
    expect(readScoutThemePreference(storage)).toEqual({
      version: 1,
      skin: "classic",
      mode: "dark",
    });
  });

  test("migrates the app key before the marketing key and removes both", () => {
    const storage = new MemoryStorage();
    storage.setItem(SCOUT_LEGACY_APP_THEME_KEY, "dark");
    storage.setItem(SCOUT_LEGACY_MARKETING_THEME_KEY, "light");
    expect(readScoutThemePreference(storage)).toEqual({
      version: 1,
      skin: "modern",
      mode: "dark",
    });
    expect(storage.getItem(SCOUT_LEGACY_APP_THEME_KEY)).toBeNull();
    expect(storage.getItem(SCOUT_LEGACY_MARKETING_THEME_KEY)).toBeNull();
  });

  test("resolves system changes without changing the stored preference", () => {
    expect(resolveScoutMode("system", true)).toBe("dark");
    expect(resolveScoutMode("system", false)).toBe("light");
    expect(
      resolveScoutTheme({ version: 1, skin: "classic", mode: "system" }, true),
    ).toBe("classic-dark");
  });

  test("uses Modern/System in memory when browser storage is unavailable", () => {
    const unavailable = new MemoryStorage();
    unavailable.getItem = () => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    };
    expect(readScoutThemePreferenceOrDefault(unavailable)).toEqual(
      DEFAULT_SCOUT_THEME_PREFERENCE,
    );
  });
});
