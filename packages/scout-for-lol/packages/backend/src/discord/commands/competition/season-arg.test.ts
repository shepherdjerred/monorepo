import { describe, expect, test } from "bun:test";
import {
  SeasonArgsSchema,
  SeasonEditArgsSchema,
} from "#src/discord/commands/competition/schemas.ts";
import { suggestSeasonCompletions } from "#src/discord/commands/competition/season-arg.ts";

describe("suggestSeasonCompletions", () => {
  const currentDate = new Date("2026-07-30T12:00:00-07:00");

  test("filters current and future seasons by display name", () => {
    expect(suggestSeasonCompletions("classic", currentDate)).toEqual([
      {
        name: "League Classic (Act 1)",
        value: "2026_SEASON_3_ACT_1",
      },
    ]);
  });

  test("filters current and future seasons by ID", () => {
    expect(suggestSeasonCompletions("season_3", currentDate)).toEqual([
      {
        name: "League Classic (Act 1)",
        value: "2026_SEASON_3_ACT_1",
      },
    ]);
  });

  test("returns no suggestions after all bundled seasons expire", () => {
    expect(
      suggestSeasonCompletions("", new Date("2026-09-23T00:00:00-07:00")),
    ).toEqual([]);
  });

  test("respects Discord's 25-choice cap", () => {
    expect(
      suggestSeasonCompletions("", currentDate).length,
    ).toBeLessThanOrEqual(25);
  });

  test("keeps create and edit submissions strictly validated", () => {
    expect(
      SeasonArgsSchema.safeParse({
        dateType: "SEASON",
        season: "manually-typed-invalid-season",
      }).success,
    ).toBe(false);
    expect(
      SeasonEditArgsSchema.safeParse({
        dateType: "SEASON",
        season: "manually-typed-invalid-season",
      }).success,
    ).toBe(false);
  });
});
