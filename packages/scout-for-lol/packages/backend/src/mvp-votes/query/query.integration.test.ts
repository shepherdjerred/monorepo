import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  createTrackedTestPlayer,
} from "#src/testing/bucks-fixtures.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import { loadMatchMvpTallyForGuilds } from "#src/mvp-votes/query/tally.ts";
import { loadMvpVoteLeaderboard } from "#src/mvp-votes/query/leaderboard.ts";
import { upsertMatchMvpVote } from "#src/mvp-votes/vote.ts";

const { prisma: db } = createTestDatabase("mvp-votes-query");

const GUILD_A = DiscordGuildIdSchema.parse("100000000000000061");
const GUILD_B = DiscordGuildIdSchema.parse("100000000000000062");
const MATCH_A = MatchIdSchema.parse("NA1_5000000101");
const MATCH_B = MatchIdSchema.parse("NA1_5000000102");
const CREATOR = DiscordAccountIdSchema.parse("160509172704739328");

async function seedContest(input: {
  matchId: string;
  gameCreationAt: Date;
  queueType: string;
}) {
  await db.matchMvpContest.create({
    data: {
      matchId: input.matchId,
      roster: freezeMvpTestRoster(input.matchId),
      gameCreationAt: input.gameCreationAt,
      queueType: input.queueType,
    },
  });
}

async function seedVote(input: {
  matchId: string;
  serverId: string;
  voter: number;
  nomineeIndex: number;
  justification?: string;
}) {
  await upsertMatchMvpVote(
    {
      matchId: MatchIdSchema.parse(input.matchId),
      serverId: DiscordGuildIdSchema.parse(input.serverId),
      voterDiscordId: bucksTestDiscordId(input.voter),
      category: "ally",
      nomineeIndex: input.nomineeIndex,
      voterPuuid: bucksTestPuuid(input.voter),
      voterTeamId: input.voter < 5 ? 100 : 200,
      ...(input.justification === undefined
        ? {}
        : { justification: input.justification }),
    },
    db,
  );
}

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.matchMvpVote.deleteMany();
  await db.matchMvpContest.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
});

describe("loadMatchMvpTallyForGuilds", () => {
  test("returns null when there is no contest", async () => {
    await expect(
      loadMatchMvpTallyForGuilds(
        {
          matchId: MATCH_A,
          guilds: [{ id: GUILD_A, name: "Alpha" }],
        },
        db,
      ),
    ).resolves.toBeNull();
  });

  test("returns null when the viewer has no votes in an enabled guild", async () => {
    await seedContest({
      matchId: MATCH_A,
      gameCreationAt: new Date("2026-09-10T00:00:00.000Z"),
      queueType: "flex",
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_B,
      voter: 0,
      nomineeIndex: 0,
    });
    await expect(
      loadMatchMvpTallyForGuilds(
        {
          matchId: MATCH_A,
          guilds: [{ id: GUILD_A, name: "Alpha" }],
        },
        db,
      ),
    ).resolves.toBeNull();
  });

  test("names guild aliases and hides another guild's ballots", async () => {
    await seedContest({
      matchId: MATCH_A,
      gameCreationAt: new Date("2026-09-10T00:00:00.000Z"),
      queueType: "flex",
    });
    await createTrackedTestPlayer(db, {
      alias: "alice",
      serverId: GUILD_A,
      discordId: bucksTestDiscordId(0),
      accounts: [bucksTestPuuid(0)],
      creatorDiscordId: CREATOR,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_A,
      voter: 1,
      nomineeIndex: 0,
      justification: "carried baron",
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_B,
      voter: 2,
      nomineeIndex: 9,
    });

    const tally = await loadMatchMvpTallyForGuilds(
      {
        matchId: MATCH_A,
        guilds: [{ id: GUILD_A, name: "Alpha" }],
      },
      db,
    );
    expect(tally).toMatchObject({
      matchId: MATCH_A,
      showGuildNames: false,
      guilds: [
        {
          guildId: GUILD_A,
          guildName: "Alpha",
          blue: [
            {
              displayName: "alice",
              championName: "Champ0",
              voteCount: 1,
              reasons: [
                { voterName: "Player1#NA1", justification: "carried baron" },
              ],
            },
          ],
          red: [],
        },
      ],
    });
  });

  test("shows guild names when two enabled guilds both have votes", async () => {
    await seedContest({
      matchId: MATCH_A,
      gameCreationAt: new Date("2026-09-10T00:00:00.000Z"),
      queueType: "flex",
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_A,
      voter: 0,
      nomineeIndex: 0,
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_B,
      voter: 1,
      nomineeIndex: 9,
    });
    const tally = await loadMatchMvpTallyForGuilds(
      {
        matchId: MATCH_A,
        guilds: [
          { id: GUILD_A, name: "Alpha" },
          { id: GUILD_B, name: "Beta" },
        ],
      },
      db,
    );
    expect(tally?.showGuildNames).toBe(true);
    expect(tally?.guilds.map((guild) => guild.guildId)).toEqual([
      GUILD_A,
      GUILD_B,
    ]);
  });
});

describe("loadMvpVoteLeaderboard", () => {
  test("aggregates votes in the UTC match window and optional queue", async () => {
    await seedContest({
      matchId: MATCH_A,
      gameCreationAt: new Date("2026-09-10T12:00:00.000Z"),
      queueType: "flex",
    });
    await seedContest({
      matchId: MATCH_B,
      gameCreationAt: new Date("2026-09-20T12:00:00.000Z"),
      queueType: "ranked 5s",
    });
    await createTrackedTestPlayer(db, {
      alias: "alice",
      serverId: GUILD_A,
      accounts: [bucksTestPuuid(0)],
      creatorDiscordId: CREATOR,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_A,
      voter: 1,
      nomineeIndex: 0,
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_A,
      voter: 2,
      nomineeIndex: 0,
    });
    await seedVote({
      matchId: MATCH_B,
      serverId: GUILD_A,
      voter: 1,
      nomineeIndex: 0,
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_B,
      voter: 3,
      nomineeIndex: 0,
    });

    const month = await loadMvpVoteLeaderboard(
      {
        serverId: GUILD_A,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
      },
      db,
    );
    expect(month.totalVotes).toBe(3);
    expect(month.rows).toEqual([
      {
        nomineePuuid: bucksTestPuuid(0),
        displayName: "alice",
        voteCount: 3,
        matchCount: 2,
      },
    ]);

    const flexOnly = await loadMvpVoteLeaderboard(
      {
        serverId: GUILD_A,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        queueType: "flex",
      },
      db,
    );
    expect(flexOnly.totalVotes).toBe(2);
    expect(flexOnly.rows[0]?.voteCount).toBe(2);
    expect(flexOnly.rows[0]?.matchCount).toBe(1);

    const early = await loadMvpVoteLeaderboard(
      {
        serverId: GUILD_A,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-15T00:00:00.000Z",
      },
      db,
    );
    expect(early.totalVotes).toBe(2);
  });

  test("falls back to the frozen Riot ID when the nominee is untracked", async () => {
    await seedContest({
      matchId: MATCH_A,
      gameCreationAt: new Date("2026-09-10T12:00:00.000Z"),
      queueType: "flex",
    });
    await seedVote({
      matchId: MATCH_A,
      serverId: GUILD_A,
      voter: 0,
      nomineeIndex: 9,
    });
    const result = await loadMvpVoteLeaderboard(
      {
        serverId: GUILD_A,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
      },
      db,
    );
    expect(result.rows).toEqual([
      {
        nomineePuuid: bucksTestPuuid(9),
        displayName: "Player9#NA1",
        voteCount: 1,
        matchCount: 1,
      },
    ]);
  });
});
