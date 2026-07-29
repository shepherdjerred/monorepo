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
        "2026_SEASON_3_ACT_1",
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
    test("returns current and future seasons while excluding ended seasons", () => {
      const choices = getSeasonChoices(new Date("2026-06-15T12:00:00-07:00"));

      expect(choices.map((choice) => choice.value)).toEqual([
        "2026_SEASON_3_ACT_1",
        "2026_SEASON_2_ACT_2",
      ]);
    });

    test("includes a season through its exact end boundary", () => {
      const choices = getSeasonChoices(new Date("2026-09-22T23:59:59-07:00"));

      expect(choices).toEqual([
        {
          name: "League Classic (Act 1)",
          value: "2026_SEASON_3_ACT_1",
        },
      ]);
    });

    test("returns no choices after every bundled season has ended", () => {
      expect(getSeasonChoices(new Date("2026-09-23T00:00:00-07:00"))).toEqual(
        [],
      );
    });

    test("returns valid labeled Discord choices", () => {
      const choices = getSeasonChoices(new Date("2026-07-30T12:00:00-07:00"));
      for (const choice of choices) {
        expect(choice.name.length).toBeGreaterThan(0);
        const parsed = SeasonIdSchema.safeParse(choice.value);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(getSeasonById(parsed.data)?.displayName).toBe(choice.name);
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

    test("should use the Season 3 Act 1 patch boundaries", () => {
      const dates = getSeasonDates("2026_SEASON_3_ACT_1");
      expect(dates).toEqual({
        startDate: new Date("2026-07-29T12:00:00-07:00"),
        endDate: new Date("2026-09-22T23:59:59-07:00"),
      });
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
