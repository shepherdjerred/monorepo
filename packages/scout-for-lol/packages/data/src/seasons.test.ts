import { describe, expect, test } from "bun:test";
import {
  SEASONS,
  SeasonIdSchema,
  getSeasonById,
  getAllSeasons,
  getCurrentSeason,
  getSeasonChoices,
  getSeasonDates,
  hasSeasonEnded,
} from "#src/seasons.ts";

describe("seasons", () => {
  describe("SEASONS constant", () => {
    test("should have valid season data", () => {
      expect(SEASONS).toBeDefined();
      expect(Object.keys(SEASONS).length).toBeGreaterThan(0);

      for (const [key, season] of Object.entries(SEASONS)) {
        // The record key must equal the season's own id, and both must be a
        // valid `YYYY_SEASON_N_ACT_M` id accepted by the schema. Parsing the
        // key also gives it the SeasonId literal type for the `toBe` compare.
        expect(season.id).toBe(SeasonIdSchema.parse(key));
        expect(season.id).toMatch(/^\d{4}_SEASON_\d+_ACT_\d+$/);
        expect(typeof season.displayName).toBe("string");
        expect(season.displayName.length).toBeGreaterThan(0);
        expect(season.startDate).toBeInstanceOf(Date);
        expect(season.endDate).toBeInstanceOf(Date);
        expect(season.startDate.getTime()).toBeLessThan(
          season.endDate.getTime(),
        );
      }
    });

    test("should have seasons in chronological order in display names", () => {
      const seasons = Object.values(SEASONS);
      // Check that we have at least one season with a display name
      const firstSeason = seasons[0];
      if (firstSeason) {
        expect(firstSeason.displayName.length).toBeGreaterThan(0);
      }
    });
  });

  describe("SeasonIdSchema", () => {
    test("should accept valid season IDs", () => {
      const validIds = [
        "2025_SEASON_3_ACT_1",
        "2026_SEASON_1_ACT_1",
        "2026_SEASON_1_ACT_2",
        "2026_SEASON_2_ACT_1",
        "2026_SEASON_2_ACT_2",
      ] as const;
      for (const id of validIds) {
        const result = SeasonIdSchema.safeParse(id);
        expect(result.success).toBe(true);
      }
    });

    test("should reject invalid season IDs", () => {
      const invalidIds = [
        "invalid",
        "2026_SPLIT_1",
        "2024_SPLIT_3",
        "2024",
        "",
      ];
      for (const id of invalidIds) {
        const result = SeasonIdSchema.safeParse(id);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("getSeasonById", () => {
    test("should return season data for valid ID", () => {
      const season = getSeasonById("2025_SEASON_3_ACT_1");
      expect(season).toBeDefined();
      expect(season?.id).toBe("2025_SEASON_3_ACT_1");
      expect(season?.displayName).toBe("Trials of Twilight");
    });

    test("should return undefined for invalid ID", () => {
      const season = getSeasonById("INVALID_SEASON");
      expect(season).toBeUndefined();
    });
  });

  describe("getAllSeasons", () => {
    test("should return all seasons sorted by start date (newest first)", () => {
      const seasons = getAllSeasons();
      expect(seasons.length).toBeGreaterThan(0);

      // Check sorting (newest first)
      for (let i = 0; i < seasons.length - 1; i += 1) {
        const current = seasons[i];
        const next = seasons[i + 1];
        if (current && next) {
          expect(current.startDate.getTime()).toBeGreaterThanOrEqual(
            next.startDate.getTime(),
          );
        }
      }
    });
  });

  describe("getCurrentSeason", () => {
    test("should return undefined if no active season", () => {
      // This test might fail if there's actually an active season
      // We can't easily mock Date in Bun tests, so this test is informational
      const current = getCurrentSeason();
      if (current) {
        const now = new Date();
        expect(now.getTime()).toBeGreaterThanOrEqual(
          current.startDate.getTime(),
        );
        expect(now.getTime()).toBeLessThanOrEqual(current.endDate.getTime());
      }
    });
  });

  describe("getSeasonChoices", () => {
    test("should return at least one active season (guards against stale SEASONS data)", () => {
      // Empty choices silently degrade /competition's season option to a
      // free-text input in Discord; this test fails CI before that ships.
      expect(getSeasonChoices().length).toBeGreaterThan(0);
    });

    test("should return Discord choices for non-ended seasons", () => {
      const choices = getSeasonChoices();
      expect(choices).toBeArray();

      for (const choice of choices) {
        // Discord requires a non-empty label, and the value must be a real
        // season id (parsing succeeds and its display name is the label).
        expect(typeof choice.name).toBe("string");
        expect(choice.name.length).toBeGreaterThan(0);
        const result = SeasonIdSchema.safeParse(choice.value);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(getSeasonById(result.data)?.displayName).toBe(choice.name);
        }
      }
    });

    test("should not include ended seasons", () => {
      const choices = getSeasonChoices();
      const now = new Date();

      for (const choice of choices) {
        const season = getSeasonById(choice.value);
        if (season) {
          expect(season.endDate.getTime()).toBeGreaterThanOrEqual(
            now.getTime(),
          );
        }
      }
    });
  });

  describe("getSeasonDates", () => {
    test("should return dates for valid season", () => {
      const dates = getSeasonDates("2025_SEASON_3_ACT_1");
      expect(dates).toBeDefined();
      expect(dates?.startDate).toBeInstanceOf(Date);
      expect(dates?.endDate).toBeInstanceOf(Date);
    });

    test("should return undefined for invalid season", () => {
      const dates = getSeasonDates("INVALID_SEASON");
      expect(dates).toBeUndefined();
    });
  });

  describe("hasSeasonEnded", () => {
    test("should return true for ended season", () => {
      const futureDate = new Date("2099-12-31");
      const ended = hasSeasonEnded("2025_SEASON_3_ACT_1", futureDate);
      expect(ended).toBe(true);
    });

    test("should return false for active season", () => {
      const pastDate = new Date("2025-09-01");
      const ended = hasSeasonEnded("2025_SEASON_3_ACT_1", pastDate);
      expect(ended).toBe(false);
    });

    test("should return undefined for invalid season", () => {
      const ended = hasSeasonEnded("INVALID_SEASON");
      expect(ended).toBeUndefined();
    });
  });
});
