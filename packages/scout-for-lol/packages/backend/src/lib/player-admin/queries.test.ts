import { describe, expect, test } from "bun:test";
import {
  CompetitionIdSchema,
  type CompetitionWithSeason,
  createPermissionSet,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  SeasonIdSchema,
} from "@scout-for-lol/data";
import {
  serializePlayerDetail,
  serializePlayerSummary,
} from "#src/lib/player-admin/queries.ts";

function makeCompetition(
  overrides: Partial<CompetitionWithSeason>,
): CompetitionWithSeason {
  return {
    id: CompetitionIdSchema.parse(5),
    serverId: DiscordGuildIdSchema.parse("100000000000000009"),
    ownerId: DiscordAccountIdSchema.parse("100000000000000002"),
    title: "Competition",
    description: "",
    channelId: DiscordChannelIdSchema.parse("100000000000000003"),
    isCancelled: false,
    visibility: "OPEN",
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "FLEX" }),
    maxParticipants: 50,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2126-01-01T00:00:00Z"),
    seasonId: null,
    startProcessedAt: null,
    endProcessedAt: null,
    updateCronExpression: null,
    nextScheduledUpdateAt: null,
    lastScheduledUpdateAt: null,
    startNotifiedAt: null,
    endNotifiedAt: null,
    startNotificationMessageId: null,
    endNotificationMessageId: null,
    creatorDiscordId: DiscordAccountIdSchema.parse("100000000000000002"),
    createdTime: new Date("2026-01-01T00:00:00Z"),
    updatedTime: new Date("2026-01-01T00:00:00Z"),
    season: null,
    ...overrides,
  };
}

const detail = {
  id: 1,
  alias: "player",
  discordId: "100000000000000001",
  creatorDiscordId: "100000000000000002",
  createdTime: new Date("2026-01-01T00:00:00Z"),
  updatedTime: new Date("2026-01-02T00:00:00Z"),
  accounts: [
    {
      id: 2,
      alias: "account",
      puuid: "secret-puuid",
      region: "AMERICA_NORTH",
      riotGameName: "Player",
      riotTagLine: "NA1",
      lastMatchTime: null,
      lastCheckedAt: null,
    },
  ],
  subscriptions: [
    {
      id: 3,
      channelId: "100000000000000003",
      creatorDiscordId: "100000000000000002",
      createdTime: new Date("2026-01-03T00:00:00Z"),
      filters: JSON.stringify({
        version: 1,
        filters: [{ type: "queue", queues: ["solo"] }],
      }),
      isMuted: false,
    },
  ],
  competitionParticipants: [
    {
      id: 4,
      status: "JOINED",
      invitedBy: "100000000000000002",
      invitedAt: null,
      joinedAt: new Date("2026-01-04T00:00:00Z"),
      leftAt: null,
      competition: makeCompetition({}),
    },
  ],
};

const summary = {
  id: detail.id,
  alias: detail.alias,
  discordId: detail.discordId,
  updatedTime: detail.updatedTime,
  accounts: detail.accounts.map((account) => ({ id: account.id })),
  subscriptions: detail.subscriptions.map((subscription) => ({
    id: subscription.id,
    channelId: subscription.channelId,
  })),
};

const allReadPermissions = createPermissionSet([
  { resource: "players", action: "read" },
  { resource: "accounts", action: "read" },
  { resource: "subscriptions", action: "read" },
  { resource: "competitions", action: "read" },
]);

describe("serializePlayerSummary", () => {
  test("redacts related-resource metadata without its read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
    ]);

    const serialized = serializePlayerSummary(summary, {}, permissions);

    expect(serialized.accountCount).toBe(0);
    expect(serialized.subscriptionCount).toBe(0);
    expect(serialized.channelIds).toEqual([]);
  });

  test("includes related-resource metadata with its read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
      { resource: "accounts", action: "read" },
      { resource: "subscriptions", action: "read" },
    ]);

    const serialized = serializePlayerSummary(summary, {}, permissions);

    expect(serialized.accountCount).toBe(1);
    expect(serialized.subscriptionCount).toBe(1);
    expect(serialized.channelIds).toEqual(["100000000000000003"]);
  });
});

describe("serializePlayerDetail", () => {
  test("redacts related resources without their read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
    ]);

    const serialized = serializePlayerDetail(detail, {}, permissions);

    expect(serialized.accounts).toEqual([]);
    expect(serialized.subscriptions).toEqual([]);
    expect(serialized.competitions).toEqual([]);
  });

  test("includes each related resource when its read scope is held", () => {
    const serialized = serializePlayerDetail(detail, {}, allReadPermissions);

    expect(serialized.accounts).toHaveLength(1);
    expect(serialized.accounts[0]?.puuid).toBe("secret-puuid");
    expect(serialized.subscriptions).toHaveLength(1);
    expect(serialized.subscriptions[0]?.filters).toEqual({
      version: 1,
      filters: [{ type: "queue", queues: ["solo"] }],
    });
    expect(serialized.subscriptions[0]?.isMuted).toBe(false);
    expect(serialized.competitions).toHaveLength(1);
    expect(serialized.competitions[0]?.competition.status).toBe("ACTIVE");
  });

  test("resolves ended season-based competitions to ENDED with season dates", () => {
    // Season-based rows store null dates; the effective dates live on the
    // joined Season row. An ended season must not read as active.
    const seasonStart = new Date("2026-01-08T00:00:00Z");
    const seasonEnd = new Date("2026-03-04T00:00:00Z");
    const player = {
      ...detail,
      competitionParticipants: [
        {
          id: 6,
          status: "JOINED",
          invitedBy: null,
          invitedAt: null,
          joinedAt: new Date("2026-01-10T00:00:00Z"),
          leftAt: null,
          competition: makeCompetition({
            startDate: null,
            endDate: null,
            seasonId: SeasonIdSchema.parse("2026_SEASON_1_ACT_1"),
            season: {
              id: "2026_SEASON_1_ACT_1",
              displayName: "Welcome to Noxus (Act 1)",
              startDate: seasonStart,
              endDate: seasonEnd,
            },
          }),
        },
      ],
    };

    const serialized = serializePlayerDetail(player, {}, allReadPermissions);

    const competition = serialized.competitions[0]?.competition;
    expect(competition?.status).toBe("ENDED");
    expect(competition?.startDate).toEqual(seasonStart);
    expect(competition?.endDate).toEqual(seasonEnd);
  });
});
