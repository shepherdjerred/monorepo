import { describe, expect, test } from "bun:test";

import {
  appearanceOverride,
  loadAppearancePreference,
  resolveAppearance,
  serializeAppearancePreference,
} from "./appearance";

describe("appearance preferences", () => {
  test("defaults new installs to the system appearance", () => {
    expect(loadAppearancePreference(null, null)).toEqual({
      appearance: "system",
      needsMigration: true,
    });
  });

  test("loads a versioned preference without migration", () => {
    expect(
      loadAppearancePreference(serializeAppearancePreference("dark"), "false"),
    ).toEqual({ appearance: "dark", needsMigration: false });
  });

  test("migrates the legacy dark mode preference", () => {
    expect(loadAppearancePreference(null, "true")).toEqual({
      appearance: "dark",
      needsMigration: true,
    });
    expect(loadAppearancePreference(null, "false")).toEqual({
      appearance: "light",
      needsMigration: true,
    });
  });

  test("rejects malformed and unknown stored preferences", () => {
    expect(() => loadAppearancePreference("not json", null)).toThrow();
    expect(() =>
      loadAppearancePreference(
        JSON.stringify({ version: 1, appearance: "sepia" }),
        null,
      ),
    ).toThrow();
    expect(() =>
      loadAppearancePreference(
        JSON.stringify({
          version: 1,
          appearance: "system",
          unexpected: true,
        }),
        null,
      ),
    ).toThrow();
    expect(() => loadAppearancePreference(null, "yes")).toThrow();
  });

  test("resolves system and explicit appearances", () => {
    expect(resolveAppearance("system", "dark")).toBe("dark");
    expect(resolveAppearance("system", "light")).toBe("light");
    expect(resolveAppearance("system", "unspecified")).toBe("light");
    expect(resolveAppearance("dark", "light")).toBe("dark");
    expect(resolveAppearance("light", "dark")).toBe("light");
  });

  test("maps the system preference to React Native's override value", () => {
    expect(appearanceOverride("system")).toBe("unspecified");
    expect(appearanceOverride("light")).toBe("light");
    expect(appearanceOverride("dark")).toBe("dark");
  });
});
