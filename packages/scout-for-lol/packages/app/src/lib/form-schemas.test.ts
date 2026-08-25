import { describe, expect, test } from "vitest";
import {
  CompetitionFormValueSchema,
  FeedbackFormSchema,
  GuildAccessFormSchema,
  ReportFormValueSchema,
  RiotIdTextSchema,
  SubscriptionFormSchema,
} from "#src/lib/form-schemas.ts";
import { validateForm } from "#src/lib/competition-form-state.ts";
import { buildReportPayload } from "#src/components/report-form-fields.tsx";

const CHANNEL_ID = "123456789012345678";
const DISCORD_USER_ID = ["123456789", "012345678"].join("");

describe("Scout editable value schemas", () => {
  test("trims reusable text inputs and rejects empty feedback", () => {
    expect(FeedbackFormSchema.parse({ body: "  useful feedback  " })).toEqual({
      body: "useful feedback",
    });
    expect(FeedbackFormSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  test("validates Riot IDs at the editable string boundary", () => {
    expect(RiotIdTextSchema.safeParse("Summoner#NA1").success).toBe(true);
    expect(RiotIdTextSchema.safeParse("Summoner").success).toBe(false);
  });

  test("preserves nullable subscription filters and optional Discord users", () => {
    const parsed = SubscriptionFormSchema.parse({
      channelId: CHANNEL_ID,
      region: "AMERICA_NORTH",
      riotId: "Summoner#NA1",
      alias: "  Mid lane  ",
      discordUserId: "",
      filters: null,
    });
    expect(parsed.alias).toBe("Mid lane");
    expect(parsed.discordUserId).toBe("");
    expect(parsed.filters).toBeNull();
  });

  test("requires a permission for a custom guild role", () => {
    expect(
      GuildAccessFormSchema.safeParse({
        discordUserId: DISCORD_USER_ID,
        role: "custom",
        permissions: [],
      }).success,
    ).toBe(false);
    expect(
      GuildAccessFormSchema.safeParse({
        discordUserId: DISCORD_USER_ID,
        role: "viewer",
        permissions: [],
      }).success,
    ).toBe(true);
  });

  test("reports conditional competition date and criteria errors", () => {
    const invalid = CompetitionFormValueSchema.safeParse({
      title: "Summer split",
      description: "A friendly competition",
      channelId: CHANNEL_ID,
      visibility: "OPEN",
      maxParticipants: "1.5",
      gameVariant: "MODERN",
      analysisTimezone: "UTC",
      dates: {
        mode: "FIXED_DATES",
        startDate: "2026-08-20",
        endDate: "2026-08-10",
        seasonId: "",
      },
      criteria: {
        criteriaType: "HIGHEST_WIN_RATE",
        queues: ["solo"],
        aggregation: "MAX",
        championId: "",
        minGames: "0",
      },
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "maxParticipants",
        "dates.endDate",
        "criteria.minGames",
      ]),
    );
  });

  test("allows a competition to start and end on the same calendar day", () => {
    const result = CompetitionFormValueSchema.safeParse({
      title: "One-day cup",
      description: "A competition contained within one calendar day",
      channelId: CHANNEL_ID,
      visibility: "OPEN",
      maxParticipants: "24",
      gameVariant: "MODERN",
      analysisTimezone: "America/Los_Angeles",
      dates: {
        mode: "FIXED_DATES",
        startDate: "2026-08-20",
        endDate: "2026-08-20",
        seasonId: "",
      },
      criteria: {
        criteriaType: "MOST_GAMES_PLAYED",
        queues: ["ALL"],
        aggregation: "MAX",
        championId: "",
        minGames: "10",
      },
    });
    expect(result.success).toBe(true);
  });

  test("maps browser-backed numeric and date values to the existing payload", () => {
    const result = validateForm({
      title: "Summer split",
      description: "A friendly competition",
      channelId: CHANNEL_ID,
      visibility: "OPEN",
      maxParticipants: "24",
      gameVariant: "MODERN",
      analysisTimezone: "UTC",
      dates: {
        mode: "FIXED_DATES",
        startDate: "2026-08-10",
        endDate: "2026-08-20",
        seasonId: "",
      },
      criteria: {
        criteriaType: "HIGHEST_WIN_RATE",
        queues: ["solo"],
        aggregation: "MAX",
        championId: "",
        minGames: "7",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxParticipants).toBe(24);
    expect(result.criteria).toEqual({
      type: "HIGHEST_WIN_RATE",
      queues: ["solo"],
      minGames: 7,
    });
    expect(result.dates.type).toBe("FIXED_DATES");
  });

  test("maps blank report descriptions to the backend nullable contract", () => {
    const value = ReportFormValueSchema.parse({
      title: "Weekly report",
      description: "",
      channelId: CHANNEL_ID,
      queryText:
        "select games from match_participants group by player render leaderboard",
      cronExpression: "0 9 * * 1",
      scheduleTimezone: "America/Los_Angeles",
    });
    expect(buildReportPayload(value)).toMatchObject({
      ok: true,
      payload: { description: null },
    });
  });
});
