import { describe, expect, test } from "bun:test";
import { parseDatesArgs } from "#src/discord/commands/competition/edit-helpers.ts";

describe("parseDatesArgs", () => {
  test("rejects an expired season edit before persistence", () => {
    expect(
      parseDatesArgs({
        startDateStr: null,
        endDateStr: null,
        seasonStr: "2025_SEASON_3_ACT_1",
        isDraft: true,
        now: new Date("2026-07-30T12:00:00-07:00"),
      }),
    ).toEqual({
      success: false,
      error:
        "Cannot edit competition to season 2025_SEASON_3_ACT_1 - this season has already ended",
    });
  });

  test("accepts a current season edit", () => {
    expect(
      parseDatesArgs({
        startDateStr: null,
        endDateStr: null,
        seasonStr: "2026_SEASON_3_ACT_1",
        isDraft: true,
        now: new Date("2026-07-30T12:00:00-07:00"),
      }),
    ).toEqual({
      success: true,
      dates: {
        dateType: "SEASON",
        season: "2026_SEASON_3_ACT_1",
      },
    });
  });
});
