import { describe, expect, test } from "bun:test";
import {
  ChampionIdSchema,
  CompetitionIdSchema,
  parseCompetition,
} from "#src/model/competition.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/discord.ts";
import { SeasonIdSchema } from "#src/seasons.ts";
import type {
  Competition,
  CompetitionWithSeason,
} from "#src/model/competition.ts";

const SCHEDULE_FIELDS = {
  updateCronExpression: null,
  nextScheduledUpdateAt: null,
  lastScheduledUpdateAt: null,
} satisfies Pick<
  Competition,
  "updateCronExpression" | "nextScheduledUpdateAt" | "lastScheduledUpdateAt"
>;

const DEFAULT_COMPETITION_NOTIFICATION_FIELDS = {
  startNotifiedAt: null,
  endNotifiedAt: null,
  startNotificationMessageId: null,
  endNotificationMessageId: null,
} as const;

describe("parseCompetition", () => {
  const baseRawCompetition: CompetitionWithSeason = {
    id: CompetitionIdSchema.parse(42),
    serverId: DiscordGuildIdSchema.parse("123456789012345678"),
    ownerId: DiscordAccountIdSchema.parse("987654321098765432"),
    title: "Test Competition",
    description: "A test competition",
    channelId: DiscordChannelIdSchema.parse("111222333444555666"),
    isCancelled: false,
    visibility: "OPEN",
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    maxParticipants: 50,
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-01-31"),
    seasonId: null,
    season: null,
    startProcessedAt: null,
    endProcessedAt: null,
    ...SCHEDULE_FIELDS,
    ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
    creatorDiscordId: DiscordAccountIdSchema.parse("987654321098765432"),
    createdTime: new Date("2024-12-01"),
    updatedTime: new Date("2024-12-01"),
  };

  test("parses MOST_GAMES_PLAYED criteria correctly", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.id).toBe(CompetitionIdSchema.parse(42));
    expect(parsed.title).toBe("Test Competition");
    expect(parsed.criteria).toEqual({
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    });
  });

  test("parses HIGHEST_RANK criteria correctly", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "FLEX" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "HIGHEST_RANK",
      queue: "FLEX",
    });
  });

  test("parses MOST_WINS_CHAMPION criteria correctly", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({
        championId: ChampionIdSchema.parse(157),
        queue: "SOLO",
      }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "MOST_WINS_CHAMPION",
      championId: ChampionIdSchema.parse(157),
      queue: "SOLO",
    });
  });

  test("parses HIGHEST_WIN_RATE criteria with default minGames", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_WIN_RATE",
      criteriaConfig: JSON.stringify({ queue: "FLEX" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "HIGHEST_WIN_RATE",
      minGames: 10,
      queue: "FLEX",
    });
  });

  test("populates startDate/endDate from the eagerly-loaded season relation", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      startDate: null,
      endDate: null,
      seasonId: SeasonIdSchema.parse("2025_SEASON_3_ACT_2"),
      season: {
        id: SeasonIdSchema.parse("2025_SEASON_3_ACT_2"),
        displayName: "Worlds 2025",
        startDate: new Date("2025-10-22T07:00:00.000Z"),
        endDate: new Date("2026-01-08T07:59:59.000Z"),
      },
    };

    const parsed = parseCompetition(raw);

    expect(parsed.startDate?.toISOString()).toBe("2025-10-22T07:00:00.000Z");
    expect(parsed.endDate?.toISOString()).toBe("2026-01-08T07:59:59.000Z");
    expect(parsed.seasonId).toBe(raw.seasonId);
  });

  test("preserves all original fields except criteriaType and criteriaConfig", () => {
    const parsed = parseCompetition(baseRawCompetition);

    expect(parsed.id).toBe(baseRawCompetition.id);
    expect(parsed.serverId).toBe(baseRawCompetition.serverId);
    expect(parsed.ownerId).toBe(baseRawCompetition.ownerId);
    expect(parsed.title).toBe(baseRawCompetition.title);
    expect(parsed.description).toBe(baseRawCompetition.description);
    expect(parsed.channelId).toBe(baseRawCompetition.channelId);
    expect(parsed.isCancelled).toBe(baseRawCompetition.isCancelled);
    expect(parsed.visibility).toBe(baseRawCompetition.visibility);
    expect(parsed.maxParticipants).toBe(baseRawCompetition.maxParticipants);
    expect(parsed.startDate).toBe(baseRawCompetition.startDate);
    expect(parsed.endDate).toBe(baseRawCompetition.endDate);
    expect(parsed.seasonId).toBe(baseRawCompetition.seasonId);
    expect(parsed.creatorDiscordId).toBe(baseRawCompetition.creatorDiscordId);
    expect(parsed.createdTime).toBe(baseRawCompetition.createdTime);
    expect(parsed.updatedTime).toBe(baseRawCompetition.updatedTime);
    expect("criteriaType" in parsed).toBe(false);
    expect("criteriaConfig" in parsed).toBe(false);
    expect(parsed.criteria).toBeDefined();
  });

  test("throws on invalid JSON in criteriaConfig", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaConfig: "{ invalid json",
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteriaConfig JSON/);
  });

  test("throws when criteriaConfig is not an object", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaConfig: JSON.stringify("not an object"),
    };

    expect(() => parseCompetition(raw)).toThrow(
      /criteriaConfig must be an object/,
    );
  });

  test("throws when criteriaConfig is null", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaConfig: JSON.stringify(null),
    };

    expect(() => parseCompetition(raw)).toThrow(
      /criteriaConfig must be an object/,
    );
  });

  test("throws when criteriaType doesn't match config", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });

  test("throws when criteria has missing required fields", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({}),
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });

  test("throws when criteria has invalid queue for HIGHEST_RANK", () => {
    const raw: CompetitionWithSeason = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "ARENA" }),
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });
});
