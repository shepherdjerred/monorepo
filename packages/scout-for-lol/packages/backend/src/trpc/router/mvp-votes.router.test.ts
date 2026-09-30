import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
} from "@scout-for-lol/data";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import { upsertMatchMvpVote } from "#src/mvp-votes/vote.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
} from "#src/testing/bucks-fixtures.ts";

const trpc = await createOfflineTrpcHarness("trpc-mvp-votes-test");
const { prisma: db } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000071");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000072");
const actor = DiscordAccountIdSchema.parse("300000000000000071");
const MATCH_ID = MatchIdSchema.parse("NA1_5000000103");

function caller() {
  return trpc.authedCaller(actor);
}

function roster() {
  return freezeMvpTestRoster(MATCH_ID);
}

describe("mvpVotes.router", () => {
  beforeEach(async () => {
    resetFlagOverrides("mvp_votes_enabled");
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await db.matchMvpVote.deleteMany();
    await db.matchMvpContest.deleteMany();
  });

  afterAll(async () => {
    resetFlagOverrides("mvp_votes_enabled");
    await db.$disconnect();
  });

  test("rejects an unauthenticated caller", async () => {
    await expect(
      trpc.anonCaller().mvpVotes.matchTally({ matchId: MATCH_ID }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(trpc.anonCaller().mvpVotes.status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("status is available for an ordinary member of an enabled guild", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: guildId });
    await expect(caller().mvpVotes.status()).resolves.toMatchObject({
      state: "available",
      guilds: [{ id: guildId }],
    });
  });

  test("returns null when no enabled guild is in scope", async () => {
    await expect(
      caller().mvpVotes.matchTally({ matchId: MATCH_ID }),
    ).resolves.toBeNull();
  });

  test("returns null when the enabled guild has no votes on the match", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: guildId });
    await db.matchMvpContest.create({
      data: {
        matchId: MATCH_ID,
        roster: roster(),
        gameCreationAt: new Date("2026-09-10T00:00:00.000Z"),
        queueType: "flex",
      },
    });
    await expect(
      caller().mvpVotes.matchTally({ matchId: MATCH_ID }),
    ).resolves.toBeNull();
  });

  test("returns the viewer's guild tally and hides another guild's votes", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: guildId });
    await db.matchMvpContest.create({
      data: {
        matchId: MATCH_ID,
        roster: roster(),
        gameCreationAt: new Date("2026-09-10T00:00:00.000Z"),
        queueType: "flex",
      },
    });
    await upsertMatchMvpVote(
      {
        matchId: MATCH_ID,
        serverId: guildId,
        voterDiscordId: bucksTestDiscordId(0),
        category: "ally",
        nomineeIndex: 0,
        voterPuuid: bucksTestPuuid(0),
        voterTeamId: 100,
      },
      db,
    );
    await upsertMatchMvpVote(
      {
        matchId: MATCH_ID,
        serverId: otherGuildId,
        voterDiscordId: bucksTestDiscordId(1),
        category: "ally",
        nomineeIndex: 9,
        voterPuuid: bucksTestPuuid(1),
        voterTeamId: 100,
      },
      db,
    );

    const tally = await caller().mvpVotes.matchTally({ matchId: MATCH_ID });
    expect(tally).toMatchObject({
      matchId: MATCH_ID,
      showGuildNames: false,
      guilds: [
        {
          guildId,
          blue: [{ displayName: "Player0#NA1", voteCount: 1 }],
          red: [],
        },
      ],
    });
  });
});
