import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  createTrackedTestPlayer,
} from "#src/testing/bucks-fixtures.ts";
import { freezeMatchMvpRoster } from "#src/mvp-votes/roster.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import { findMatchMvpVoter } from "#src/mvp-votes/eligibility.ts";
import { handleMvpVoteButton } from "#src/mvp-votes/button-handler.ts";
import { formatVoteButtonCustomId } from "#src/mvp-votes/custom-id.ts";
import {
  ensureMatchMvpContest,
  listMatchMvpReportRefs,
  listMatchMvpVotes,
  recordMatchMvpReportRefs,
  setMatchMvpJustification,
  upsertMatchMvpVote,
} from "#src/mvp-votes/vote.ts";

const { prisma: db } = createTestDatabase("mvp-votes");

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const MATCH_ID = MatchIdSchema.parse("NA1_5000000099");
const VOTER = bucksTestDiscordId(1);
const OTHER = bucksTestDiscordId(2);
const RIFT_FIXTURE = new URL("../../../../testdata/rift.json", import.meta.url);

function roster() {
  return freezeMvpTestRoster(MATCH_ID);
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

describe("Match MVP votes", () => {
  test("records both categories, replaces a pick, and stores a justification", async () => {
    const frozen = roster();
    await db.matchMvpContest.create({
      data: { matchId: MATCH_ID, roster: frozen },
    });
    await createTrackedTestPlayer(db, {
      alias: "alice",
      serverId: SERVER_ID,
      discordId: VOTER,
      accounts: [bucksTestPuuid(0)],
      creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      createdAt: new Date("2026-09-19T00:00:00.000Z"),
    });

    const voter = await findMatchMvpVoter(
      { serverId: SERVER_ID, discordId: VOTER, roster: frozen },
      db,
    );
    expect(voter?.alias).toBe("alice");
    expect(voter?.rosterIndex).toBe(0);

    const ally = await upsertMatchMvpVote(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        voterDiscordId: VOTER,
        category: "ally",
        nomineeIndex: 9,
        voterPuuid: bucksTestPuuid(0),
        voterTeamId: 100,
      },
      db,
    );
    expect(ally.nomineeIndex).toBe(9);
    expect(ally.nomineePuuid).toBe(bucksTestPuuid(9));
    expect(ally.nomineeTeamId).toBe(200);
    expect(ally.justification).toBeNull();

    await upsertMatchMvpVote(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        voterDiscordId: VOTER,
        category: "enemy",
        nomineeIndex: 0,
        voterPuuid: bucksTestPuuid(0),
        voterTeamId: 100,
      },
      db,
    );

    const replaced = await upsertMatchMvpVote(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        voterDiscordId: VOTER,
        category: "ally",
        nomineeIndex: 1,
        voterPuuid: bucksTestPuuid(0),
        voterTeamId: 100,
      },
      db,
    );
    expect(replaced.nomineeIndex).toBe(1);
    expect(replaced.justification).toBeNull();

    const withReason = await setMatchMvpJustification(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        voterDiscordId: VOTER,
        category: "ally",
        justification: "threw at baron",
      },
      db,
    );
    expect(withReason.justification).toBe("threw at baron");

    const votes = await listMatchMvpVotes(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
    );
    expect(votes).toHaveLength(2);
  });

  test("a later linked Player on the same Discord wins when the oldest did not play", async () => {
    const frozen = roster();
    await db.matchMvpContest.create({
      data: { matchId: MATCH_ID, roster: frozen },
    });
    await createTrackedTestPlayer(db, {
      alias: "spectator",
      serverId: SERVER_ID,
      discordId: VOTER,
      accounts: [bucksTestPuuid(20)],
      creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      createdAt: new Date("2026-09-19T00:00:00.000Z"),
    });
    await createTrackedTestPlayer(db, {
      alias: "alice",
      serverId: SERVER_ID,
      discordId: VOTER,
      accounts: [bucksTestPuuid(0)],
      creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      createdAt: new Date("2026-09-19T00:00:01.000Z"),
    });

    const voter = await findMatchMvpVoter(
      { serverId: SERVER_ID, discordId: VOTER, roster: frozen },
      db,
    );
    expect(voter?.alias).toBe("alice");
    expect(voter?.rosterIndex).toBe(0);
  });

  test("persists report message refs on the contest, not the ActiveGame TTL", async () => {
    const frozen = roster();
    await db.matchMvpContest.create({
      data: { matchId: MATCH_ID, roster: frozen },
    });
    await recordMatchMvpReportRefs(
      MATCH_ID,
      new Map([["1337623164146155594", "100000000000000001"]]),
      db,
    );
    await recordMatchMvpReportRefs(
      MATCH_ID,
      new Map([["1337623164146155595", "100000000000000002"]]),
      db,
    );
    const refs = await listMatchMvpReportRefs(MATCH_ID, db);
    expect(
      [...refs].sort((left, right) =>
        left.channelId.localeCompare(right.channelId),
      ),
    ).toEqual([
      {
        channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
        messageId: "100000000000000001",
      },
      {
        channelId: DiscordChannelIdSchema.parse("1337623164146155595"),
        messageId: "100000000000000002",
      },
    ]);
  });

  test("a vote-button click records the source report message", async () => {
    const frozen = roster();
    await db.matchMvpContest.create({
      data: { matchId: MATCH_ID, roster: frozen },
    });
    await handleMvpVoteButton(
      {
        customId: formatVoteButtonCustomId({
          category: "ally",
          matchId: MATCH_ID,
        }),
        guildId: SERVER_ID,
        channelId: "1337623164146155594",
        message: { id: "100000000000000001" },
        user: { id: VOTER },
        deferReply: () => Promise.resolve(undefined),
        editReply: () => Promise.resolve(undefined),
      },
      db,
    );
    await expect(listMatchMvpReportRefs(MATCH_ID, db)).resolves.toEqual([
      {
        channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
        messageId: "100000000000000001",
      },
    ]);
  });

  test("a linked Discord who did not play cannot vote", async () => {
    const frozen = roster();
    await createTrackedTestPlayer(db, {
      alias: "spectator",
      serverId: SERVER_ID,
      discordId: OTHER,
      accounts: [bucksTestPuuid(20)],
      creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      createdAt: new Date("2026-09-19T00:00:00.000Z"),
    });
    await expect(
      findMatchMvpVoter(
        { serverId: SERVER_ID, discordId: OTHER, roster: frozen },
        db,
      ),
    ).resolves.toBeUndefined();
  });

  test("fills query columns on a contest that predated those fields", async () => {
    const match = RawMatchSchema.parse(await Bun.file(RIFT_FIXTURE).json());
    const matchId = MatchIdSchema.parse(match.metadata.matchId);
    await db.matchMvpContest.create({
      data: { matchId, roster: freezeMatchMvpRoster(match) },
    });

    await ensureMatchMvpContest(match, db);

    const stored = await db.matchMvpContest.findUniqueOrThrow({
      where: { matchId },
    });
    expect(stored.gameCreationAt).toEqual(new Date(match.info.gameCreation));
    expect(stored.queueType).toBe("flex");
  });
});
