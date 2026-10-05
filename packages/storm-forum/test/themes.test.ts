import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { resolveTheme, themeCatalog, ThemeCatalogSchema } from "#src/themes.ts";

describe("Pacific festival calendar", () => {
  it("ships every scenery size and decoration referenced by the complete catalog", async () => {
    expect(themeCatalog.themes).toHaveLength(13);
    const assets = [
      ...Object.values(themeCatalog.scenery).flatMap((scene) => [
        scene.desktop,
        scene.mobile,
      ]),
      ...themeCatalog.themes.flatMap((theme) =>
        theme.decoration === null ? [] : [theme.decoration],
      ),
    ];
    await Promise.all(
      assets.map((asset) =>
        access(new URL(`../assets/${asset}`, import.meta.url)),
      ),
    );
  });
  const boundaries = [
    ["2026-01-01T08:00:00Z", "christmas", "newyear"],
    ["2026-02-01T08:00:00Z", "newyear", "valentines"],
    ["2026-03-01T08:00:00Z", "valentines", "spring"],
    ["2026-03-15T07:00:00Z", "spring", "easter"],
    ["2026-05-01T07:00:00Z", "easter", "spring"],
    ["2026-06-01T07:00:00Z", "spring", "midsummer"],
    ["2026-07-08T07:00:00Z", "midsummer", "summer"],
    ["2026-09-01T07:00:00Z", "summer", "harvest"],
    ["2026-10-01T07:00:00Z", "harvest", "halloween"],
    ["2026-11-01T07:00:00Z", "halloween", "thanksgiving"],
    ["2026-12-01T08:00:00Z", "thanksgiving", "christmas"],
  ] as const;
  it.each(boundaries)("changes exactly at %s", (date, before, after) => {
    const midnight = new Date(date);
    expect(resolveTheme("auto", true, new Date(midnight.getTime() - 1))).toBe(
      before,
    );
    expect(resolveTheme("auto", true, midnight)).toBe(after);
  });
  it("includes leap day and handles both DST transitions", () => {
    for (const date of ["2024-02-29T20:00:00Z", "2024-03-01T07:59:59Z"]) {
      expect(resolveTheme("auto", true, new Date(date))).toBe("valentines");
    }
    for (const date of ["2026-03-08T09:59:59Z", "2026-03-08T10:00:00Z"]) {
      expect(resolveTheme("auto", true, new Date(date))).toBe("spring");
    }
    for (const date of ["2026-11-01T08:59:59Z", "2026-11-01T09:00:00Z"]) {
      expect(resolveTheme("auto", true, new Date(date))).toBe("thanksgiving");
    }
  });
  it("defaults safely and keeps every manual theme independent of calendar enablement", () => {
    const now = new Date("2026-10-04T20:00:00Z");
    expect(resolveTheme("auto", false, now)).toBe("normal");
    for (const theme of themeCatalog.themes) {
      expect(resolveTheme(theme.id, true, now)).toBe(theme.id);
      expect(resolveTheme(theme.id, false, now)).toBe(theme.id);
    }
    expect(() => resolveTheme("unknown", true, now)).toThrow();
  });
  it("rejects duplicate IDs, missing scenery, invalid and overlapping windows", () => {
    const first = themeCatalog.themes[0];
    expect(
      ThemeCatalogSchema.safeParse({
        ...themeCatalog,
        themes: [...themeCatalog.themes, first],
      }).success,
    ).toBe(false);
    expect(
      ThemeCatalogSchema.safeParse({ ...themeCatalog, scenery: {} }).success,
    ).toBe(false);
    expect(
      ThemeCatalogSchema.safeParse({
        ...themeCatalog,
        themes: themeCatalog.themes.map((theme) => ({
          ...theme,
          window: [230, 231],
        })),
      }).success,
    ).toBe(false);
    expect(
      ThemeCatalogSchema.safeParse({
        ...themeCatalog,
        themes: themeCatalog.themes.map((theme) => ({
          ...theme,
          window: [101, 131],
        })),
      }).success,
    ).toBe(false);
  });
});
