import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DuelRulesetV1Schema,
  type AccountId,
  type DiscordAccountId,
  type PlayerId,
  type Region,
} from "@scout-for-lol/data";
import {
  createDuelEvent,
  startDuelEvent,
} from "#src/progression/duels/events.ts";
import {
  acceptDuelEventRegistration,
  registerDuelEventEntrant,
} from "#src/progression/duels/registration.ts";
import { advanceDuelEvent } from "#src/progression/duels/advancement.ts";
import { launchDuelSeries } from "#src/progression/duels/launch.ts";
import { decideDuelSeries } from "#src/progression/duels/review.ts";
import {
  acceptDuelChallenge,
  acceptDuelDisclosure,
  createDirectDuel,
  getDuelCode,
  getDuelSeries,
  markDuelReady,
} from "#src/progression/duels/series.ts";
import { listGuildDuels } from "#src/progression/duels/read.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

vi.mock("#src/progression/duels/launch.ts", () => ({
  launchDuelSeries: vi.fn(() => Promise.resolve()),
}));

const { prisma: db, dbPath } = createTestDatabase("duel-persistence");
const GUILD_ID = testGuildId("731");
const ORGANIZER_ID = testAccountId("731");
const CHANNEL_ID = testChannelId("731");
const RULESET = DuelRulesetV1Schema.parse({
  version: 1,
  killTarget: 1,
  laneCsTarget: null,
  firstTurret: false,
});

async function createPlayer(
  index: number,
  region: Region = "AMERICA_NORTH",
): Promise<{
  playerId: PlayerId;
  accountId: AccountId;
  discordId: DiscordAccountId;
}> {
  const discordId = testAccountId(`731${index.toString()}`);
  const player = await db.player.create({
    data: {
      alias: `Duel Player ${index.toString()}`,
      discordId,
      serverId: GUILD_ID,
      creatorDiscordId: ORGANIZER_ID,
      createdTime: new Date(),
      updatedTime: new Date(),
      accounts: {
        create: {
          alias: `Duel Account ${index.toString()}`,
          puuid: testPuuid(`duel-${index.toString()}`),
          region,
          serverId: GUILD_ID,
          creatorDiscordId: ORGANIZER_ID,
          createdTime: new Date(),
          updatedTime: new Date(),
        },
      },
    },
    include: { accounts: true },
  });
  const account = player.accounts[0];
  if (account === undefined) throw new Error("Duel fixture needs an account");
  return { playerId: player.id, accountId: account.id, discordId };
}

async function createTestDirectDuel(
  first: Awaited<ReturnType<typeof createPlayer>>,
  second: Awaited<ReturnType<typeof createPlayer>>,
  requestId = crypto.randomUUID(),
  matchWindowHours = 168,
) {
  return await createDirectDuel(db, {
    requestId,
    guildId: GUILD_ID,
    organizerDiscordId: ORGANIZER_ID,
    channelId: CHANNEL_ID,
    competitorKind: "player",
    first: { accountIds: [first.accountId] },
    second: { accountIds: [second.accountId] },
    bestOf: 1,
    ruleset: RULESET,
    matchWindowHours,
    stage: "dev",
  });
}

async function verifyConcurrentDirectDuelRetries(): Promise<void> {
  const first = await createPlayer(1);
  const second = await createPlayer(2);
  const requestId = crypto.randomUUID();

  const retries = await Promise.all([
    createTestDirectDuel(first, second, requestId),
    createTestDirectDuel(first, second, requestId),
  ]);

  expect(retries[0]).toEqual(retries[1]);
  expect(await db.duelSeries.count()).toBe(1);
  expect(await db.duelCompetitor.count()).toBe(2);
  expect(await db.duelStatusOutbox.count()).toBe(1);
}

async function verifyCurrentDiscordIdentity(): Promise<void> {
  const first = await createPlayer(1);
  const second = await createPlayer(2);
  const duel = await createTestDirectDuel(first, second);
  await acceptDuelDisclosure(db, {
    guildId: GUILD_ID,
    playerId: first.playerId,
    discordId: first.discordId,
  });
  const replacementDiscordId = testAccountId("73188");
  await db.player.update({
    where: { id: first.playerId },
    data: { discordId: replacementDiscordId },
  });

  await expect(
    acceptDuelChallenge(db, duel.seriesId, first.discordId, GUILD_ID),
  ).rejects.toThrow("Only an assigned participant");
  await expect(
    acceptDuelChallenge(db, duel.seriesId, replacementDiscordId, GUILD_ID),
  ).rejects.toThrow("Accept the custom-match disclosure");
  await acceptDuelDisclosure(db, {
    guildId: GUILD_ID,
    playerId: first.playerId,
    discordId: replacementDiscordId,
  });
  await acceptDuelChallenge(db, duel.seriesId, replacementDiscordId, GUILD_ID);

  await expect(
    db.duelSeriesParticipant.findUniqueOrThrow({
      where: {
        seriesId_playerId: {
          seriesId: duel.seriesId,
          playerId: first.playerId,
        },
      },
    }),
  ).resolves.toMatchObject({
    discordId: replacementDiscordId,
    acceptedAt: expect.any(Date),
  });
}

async function verifyCommitteeSeriesRecord(): Promise<void> {
  const first = await createPlayer(1);
  const second = await createPlayer(2);
  const event = await createDuelEvent(db, {
    guildId: GUILD_ID,
    name: "Committee event",
    format: "single_elimination",
    competitorKind: "player",
    bestOf: 3,
    ruleset: RULESET,
    registrationMode: "invitations",
    seedMethod: "manual",
    matchWindowHours: 168,
    channelId: CHANNEL_ID,
    organizerDiscordId: ORGANIZER_ID,
    roundOverrides: [],
  });
  const duel = await createTestDirectDuel(first, second);
  const series = await db.duelSeries.update({
    where: { id: duel.seriesId },
    data: { eventId: event.id, seriesState: "needs_review", bestOf: 3 },
  });
  await db.duelGame.create({
    data: {
      seriesId: series.id,
      gameNumber: 1,
      gameState: "completed",
      resultState: "verified",
      winnerCompetitorId: series.competitorOneId,
    },
  });

  await decideDuelSeries(db, {
    seriesId: series.id,
    guildId: GUILD_ID,
    actorDiscordId: ORGANIZER_ID,
    idempotencyKey: "committee-after-played-game",
    reason: "Remaining games could not be completed",
    decision: {
      kind: "advance",
      winnerCompetitorId: series.competitorOneId,
    },
  });

  const records = await db.duelRecord.findMany({
    where: {
      guildId: GUILD_ID,
      scope: "individual",
      subjectKey: {
        in: [
          `player:${first.playerId.toString()}`,
          `player:${second.playerId.toString()}`,
        ],
      },
    },
    orderBy: { subjectKey: "asc" },
  });
  expect(records).toHaveLength(2);
  expect(records.map((record) => record.games)).toEqual([0, 0]);
  expect(records.map((record) => record.series)).toEqual([1, 1]);
  expect(
    records
      .map((record) => record.seriesWins)
      .toSorted((left, right) => left - right),
  ).toEqual([0, 1]);
}

async function verifyRoundRobinAcceptanceCap(): Promise<void> {
  const players = await Promise.all(
    Array.from(
      { length: 17 },
      async (_, index) => await createPlayer(index + 1),
    ),
  );
  const event = await createDuelEvent(db, {
    guildId: GUILD_ID,
    name: "Capped round robin",
    format: "round_robin",
    competitorKind: "player",
    bestOf: 1,
    ruleset: RULESET,
    registrationMode: "invitations",
    seedMethod: "manual",
    matchWindowHours: 168,
    channelId: CHANNEL_ID,
    organizerDiscordId: ORGANIZER_ID,
    roundOverrides: [],
  });
  const registrations: { readonly competitorId: string }[] = [];
  for (const player of players) {
    registrations.push(
      await registerDuelEventEntrant(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        actorDiscordId: ORGANIZER_ID,
        selection: { accountIds: [player.accountId] },
        source: "invitation",
      }),
    );
  }
  for (const [index, player] of players.slice(0, 15).entries()) {
    const registration = registrations[index];
    if (registration === undefined) {
      throw new Error("Accepted entrant fixture is incomplete");
    }
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: player.playerId,
      discordId: player.discordId,
    });
    await acceptDuelEventRegistration(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      competitorId: registration.competitorId,
      actorDiscordId: player.discordId,
    });
  }
  const finalPlayers = players.slice(15);
  await Promise.all(
    finalPlayers.map(async (player) => {
      await acceptDuelDisclosure(db, {
        guildId: GUILD_ID,
        playerId: player.playerId,
        discordId: player.discordId,
      });
    }),
  );
  const finalAcceptances = await Promise.allSettled(
    finalPlayers.map(async (player, index) => {
      const registration = registrations[index + 15];
      if (registration === undefined) {
        throw new Error("Final entrant fixture is incomplete");
      }
      await acceptDuelEventRegistration(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        competitorId: registration.competitorId,
        actorDiscordId: player.discordId,
      });
    }),
  );

  expect(
    finalAcceptances.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    finalAcceptances.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  expect(
    await db.duelEventEntrant.count({
      where: { eventId: event.id, registrationState: "accepted" },
    }),
  ).toBe(16);
  expect(
    await db.duelEventEntrant.count({
      where: { eventId: event.id, registrationState: "pending" },
    }),
  ).toBe(1);
}

async function verifyCodeVisibilityAfterIdentityChange(): Promise<void> {
  const first = await createPlayer(1);
  const second = await createPlayer(2);
  const duel = await createTestDirectDuel(first, second);
  for (const player of [first, second]) {
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: player.playerId,
      discordId: player.discordId,
    });
    await acceptDuelChallenge(db, duel.seriesId, player.discordId, GUILD_ID);
    await markDuelReady(db, duel.seriesId, player.discordId, GUILD_ID);
  }
  const lobby = await db.tournamentLobby.create({
    data: {
      code: `DUEL-CODE-${crypto.randomUUID()}`,
      apiMode: "stub",
      providerId: 1,
      tournamentId: 2,
      region: "AMERICA_NORTH",
      platformId: "NA1",
      serverId: GUILD_ID,
      channelId: CHANNEL_ID,
      creatorDiscordId: ORGANIZER_ID,
      bluePuuids: "[]",
      redPuuids: "[]",
      blueAliases: "[]",
      redAliases: "[]",
      teamSize: 2,
      pickType: "TOURNAMENT_DRAFT",
      mapType: "SUMMONERS_RIFT",
      spectatorType: "ALL",
      state: "created",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await db.duelSeries.update({
    where: { id: duel.seriesId },
    data: { seriesState: "code_ready" },
  });
  await db.duelGame.create({
    data: {
      seriesId: duel.seriesId,
      gameNumber: 1,
      gameState: "code_ready",
      tournamentLobbyId: lobby.id,
    },
  });

  const replacementDiscordId = testAccountId("73188");
  await db.player.update({
    where: { id: first.playerId },
    data: { discordId: replacementDiscordId },
  });
  await expect(
    getDuelCode(db, duel.seriesId, replacementDiscordId, GUILD_ID),
  ).rejects.toThrow(
    "Tournament codes are visible only to assigned participants",
  );
  await expect(
    getDuelCode(db, duel.seriesId, first.discordId, GUILD_ID),
  ).rejects.toThrow(
    "Tournament codes are visible only to assigned participants",
  );
}

beforeEach(async () => {
  vi.mocked(launchDuelSeries).mockClear();
  await db.duelStatusOutbox.deleteMany();
  await db.duelSeries.deleteMany();
  await db.duelEvent.deleteMany();
  await db.duelDisclosureAcceptance.deleteMany();
  await db.duelRecord.deleteMany();
  await db.duelCompetitorMember.deleteMany();
  await db.duelCompetitor.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
});

afterAll(async () => {
  await dropTestDatabase(db, dbPath);
});

describe("duel persistence", () => {
  test("deduplicates concurrent direct-challenge retries", async () => {
    await verifyConcurrentDirectDuelRetries();
  });

  test("rejects a direct duel whose frozen accounts span Riot regions", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2, "EU_WEST");

    await expect(createTestDirectDuel(first, second)).rejects.toThrow(
      "one Riot region",
    );
    expect(await db.duelSeries.count()).toBe(0);
  });

  test("keeps a direct duel private until every player accepts disclosure", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2);
    const outsider = testAccountId("73199");
    const duel = await createTestDirectDuel(first, second);

    await expect(
      acceptDuelChallenge(db, duel.seriesId, first.discordId, GUILD_ID),
    ).rejects.toThrow("Accept the custom-match disclosure");
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: first.playerId,
      discordId: first.discordId,
    });
    await acceptDuelChallenge(db, duel.seriesId, first.discordId, GUILD_ID);
    await expect(
      getDuelSeries(db, duel.seriesId, outsider, GUILD_ID),
    ).rejects.toThrow("private until every participant accepts");

    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: second.playerId,
      discordId: second.discordId,
    });
    await acceptDuelChallenge(db, duel.seriesId, second.discordId, GUILD_ID);
    await expect(
      getDuelSeries(db, duel.seriesId, outsider, GUILD_ID),
    ).resolves.toMatchObject({
      id: duel.seriesId,
      participants: [
        { accepted: true, ready: false },
        { accepted: true, ready: false },
      ],
    });

    expect(await db.bucksAccount.count()).toBe(0);
    expect(await db.bucksLedgerEntry.count()).toBe(0);

    await db.account.deleteMany({
      where: { playerId: { in: [first.playerId, second.playerId] } },
    });
    await db.player.deleteMany({
      where: { id: { in: [first.playerId, second.playerId] } },
    });
    await expect(
      getDuelSeries(db, duel.seriesId, outsider, GUILD_ID),
    ).resolves.toMatchObject({
      competitorOne: {
        accounts: [{ playerAlias: "Duel Player 1" }],
      },
      competitorTwo: {
        accounts: [{ playerAlias: "Duel Player 2" }],
      },
    });
  });

  test("moves direct acceptance to the player's current Discord identity", async () => {
    await verifyCurrentDiscordIdentity();
  });

  test("requires renewed acceptance before readiness after an identity change", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2);
    const duel = await createTestDirectDuel(first, second);
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: first.playerId,
      discordId: first.discordId,
    });
    await acceptDuelChallenge(db, duel.seriesId, first.discordId, GUILD_ID);
    const replacementDiscordId = testAccountId("73188");
    await db.player.update({
      where: { id: first.playerId },
      data: { discordId: replacementDiscordId },
    });
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: first.playerId,
      discordId: replacementDiscordId,
    });

    await expect(
      markDuelReady(db, duel.seriesId, replacementDiscordId, GUILD_ID),
    ).rejects.toThrow("Accept the duel again");

    await acceptDuelChallenge(
      db,
      duel.seriesId,
      replacementDiscordId,
      GUILD_ID,
    );
    await expect(
      markDuelReady(db, duel.seriesId, replacementDiscordId, GUILD_ID),
    ).resolves.toMatchObject({ deadlineAt: expect.any(Date) });
  });

  test("does not reveal a code to an identity that has not re-consented", async () => {
    await verifyCodeVisibilityAfterIdentityChange();
  });

  test("revokes member-wide list visibility after an identity change", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2);
    const outsider = testAccountId("73199");
    const duel = await createTestDirectDuel(first, second);
    for (const player of [first, second]) {
      await acceptDuelDisclosure(db, {
        guildId: GUILD_ID,
        playerId: player.playerId,
        discordId: player.discordId,
      });
      await acceptDuelChallenge(db, duel.seriesId, player.discordId, GUILD_ID);
    }
    await expect(listGuildDuels(db, GUILD_ID, outsider)).resolves.toMatchObject(
      { direct: [{ id: duel.seriesId }] },
    );

    const replacementDiscordId = testAccountId("73188");
    await db.player.update({
      where: { id: first.playerId },
      data: { discordId: replacementDiscordId },
    });

    await expect(listGuildDuels(db, GUILD_ID, outsider)).resolves.toMatchObject(
      { direct: [] },
    );
    await expect(
      listGuildDuels(db, GUILD_ID, replacementDiscordId),
    ).resolves.toMatchObject({ direct: [{ id: duel.seriesId }] });
  });

  test("records a committee series result only after a verified game", async () => {
    await verifyCommitteeSeriesRecord();
  });

  test("rejects no-contest decisions that would deadlock an event", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2);
    const event = await createDuelEvent(db, {
      guildId: GUILD_ID,
      name: "Reviewable event",
      format: "single_elimination",
      competitorKind: "player",
      bestOf: 1,
      ruleset: RULESET,
      registrationMode: "invitations",
      seedMethod: "manual",
      matchWindowHours: 168,
      channelId: CHANNEL_ID,
      organizerDiscordId: ORGANIZER_ID,
      roundOverrides: [],
    });
    const duel = await createTestDirectDuel(first, second);
    await db.duelSeries.update({
      where: { id: duel.seriesId },
      data: { eventId: event.id, seriesState: "needs_review" },
    });

    await expect(
      decideDuelSeries(db, {
        seriesId: duel.seriesId,
        guildId: GUILD_ID,
        actorDiscordId: ORGANIZER_ID,
        idempotencyKey: "structured-no-contest",
        reason: "Both players were unavailable",
        decision: { kind: "no_contest" },
      }),
    ).rejects.toThrow("cannot be closed as no-contest");
    expect(await db.duelAuditDecision.count()).toBe(0);
    await expect(
      db.duelSeries.findUniqueOrThrow({ where: { id: duel.seriesId } }),
    ).resolves.toMatchObject({ seriesState: "needs_review" });
  });

  test("preserves the configured match window when committeeing a replay", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2);
    const duel = await createTestDirectDuel(
      first,
      second,
      crypto.randomUUID(),
      24,
    );
    await db.duelSeries.update({
      where: { id: duel.seriesId },
      data: { seriesState: "needs_review" },
    });
    const beforeDecision = Date.now();

    const decision = await decideDuelSeries(db, {
      seriesId: duel.seriesId,
      guildId: GUILD_ID,
      actorDiscordId: ORGANIZER_ID,
      idempotencyKey: "configured-replay-window",
      reason: "Timeline evidence was incomplete",
      decision: { kind: "replay" },
    });

    const expectedDeadline = beforeDecision + 24 * 60 * 60 * 1000;
    expect(decision.deadlineAt.getTime()).toBeGreaterThanOrEqual(
      expectedDeadline,
    );
    expect(decision.deadlineAt.getTime()).toBeLessThan(expectedDeadline + 1000);
  });
});

describe("duel event registration", () => {
  test("rejects an entrant from another Riot region", async () => {
    const first = await createPlayer(1);
    const second = await createPlayer(2, "EU_WEST");
    const event = await createDuelEvent(db, {
      guildId: GUILD_ID,
      name: "One-region event",
      format: "single_elimination",
      competitorKind: "player",
      bestOf: 1,
      ruleset: RULESET,
      registrationMode: "invitations",
      seedMethod: "manual",
      matchWindowHours: 168,
      channelId: CHANNEL_ID,
      organizerDiscordId: ORGANIZER_ID,
      roundOverrides: [],
    });
    await registerDuelEventEntrant(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      actorDiscordId: ORGANIZER_ID,
      selection: { accountIds: [first.accountId] },
      source: "invitation",
    });

    await expect(
      registerDuelEventEntrant(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        actorDiscordId: ORGANIZER_ID,
        selection: { accountIds: [second.accountId] },
        source: "invitation",
      }),
    ).rejects.toThrow("one Riot region");
    expect(
      await db.duelEventEntrant.count({ where: { eventId: event.id } }),
    ).toBe(1);
  });

  test("requires disclosure from the player's current Discord identity", async () => {
    const player = await createPlayer(1);
    const event = await createDuelEvent(db, {
      guildId: GUILD_ID,
      name: "Identity-bound disclosure",
      format: "single_elimination",
      competitorKind: "player",
      bestOf: 1,
      ruleset: RULESET,
      registrationMode: "invitations",
      seedMethod: "manual",
      matchWindowHours: 168,
      channelId: CHANNEL_ID,
      organizerDiscordId: ORGANIZER_ID,
      roundOverrides: [],
    });
    const entrant = await registerDuelEventEntrant(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      actorDiscordId: ORGANIZER_ID,
      selection: { accountIds: [player.accountId] },
      source: "invitation",
    });
    await expect(
      registerDuelEventEntrant(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        actorDiscordId: ORGANIZER_ID,
        selection: { accountIds: [player.accountId] },
        source: "invitation",
      }),
    ).rejects.toThrow("may enter an event only once");
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: player.playerId,
      discordId: player.discordId,
    });
    const replacementDiscordId = testAccountId("73188");
    await db.player.update({
      where: { id: player.playerId },
      data: { discordId: replacementDiscordId },
    });

    await expect(
      acceptDuelEventRegistration(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        competitorId: entrant.competitorId,
        actorDiscordId: replacementDiscordId,
      }),
    ).rejects.toThrow("Every teammate must accept");

    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: player.playerId,
      discordId: replacementDiscordId,
    });
    await expect(
      acceptDuelEventRegistration(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        competitorId: entrant.competitorId,
        actorDiscordId: replacementDiscordId,
      }),
    ).resolves.toBeUndefined();

    const second = await createPlayer(2);
    const secondEntrant = await registerDuelEventEntrant(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      actorDiscordId: ORGANIZER_ID,
      selection: { accountIds: [second.accountId] },
      source: "invitation",
    });
    await acceptDuelDisclosure(db, {
      guildId: GUILD_ID,
      playerId: second.playerId,
      discordId: second.discordId,
    });
    await acceptDuelEventRegistration(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      competitorId: secondEntrant.competitorId,
      actorDiscordId: second.discordId,
    });
    await db.player.update({
      where: { id: player.playerId },
      data: { discordId: testAccountId("73189") },
    });

    await expect(
      startDuelEvent(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        actorDiscordId: ORGANIZER_ID,
        stage: "dev",
        manualOrder: [entrant.competitorId, secondEntrant.competitorId],
      }),
    ).rejects.toThrow("retain disclosure consent");
  });

  test("serializes acceptance at the round-robin entrant cap", async () => {
    await verifyRoundRobinAcceptanceCap();
  });
});

describe("duel event advancement", () => {
  test("preserves standard five-entrant byes and advances idempotently", async () => {
    const players = await Promise.all(
      [1, 2, 3, 4, 5].map(async (index) => await createPlayer(index)),
    );
    const event = await createDuelEvent(db, {
      guildId: GUILD_ID,
      name: "Five player bracket",
      format: "single_elimination",
      competitorKind: "player",
      bestOf: 1,
      ruleset: RULESET,
      registrationMode: "invitations",
      seedMethod: "manual",
      matchWindowHours: 168,
      channelId: CHANNEL_ID,
      organizerDiscordId: ORGANIZER_ID,
      roundOverrides: [],
    });
    const competitorIds: string[] = [];
    for (const player of players) {
      const entrant = await registerDuelEventEntrant(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        actorDiscordId: ORGANIZER_ID,
        selection: { accountIds: [player.accountId] },
        source: "invitation",
      });
      competitorIds.push(entrant.competitorId);
      await acceptDuelDisclosure(db, {
        guildId: GUILD_ID,
        playerId: player.playerId,
        discordId: player.discordId,
      });
      await acceptDuelEventRegistration(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        competitorId: entrant.competitorId,
        actorDiscordId: player.discordId,
      });
    }
    const [seedOne, seedTwo, seedThree, seedFour, seedFive] = competitorIds;
    if (
      seedOne === undefined ||
      seedTwo === undefined ||
      seedThree === undefined ||
      seedFour === undefined ||
      seedFive === undefined
    ) {
      throw new Error("Five-player bracket fixture is incomplete");
    }

    const firstRound = await startDuelEvent(db, {
      guildId: GUILD_ID,
      eventId: event.id,
      actorDiscordId: ORGANIZER_ID,
      stage: "dev",
      manualOrder: competitorIds,
    });
    const firstPlayer = players[0];
    if (firstPlayer === undefined) {
      throw new Error("Five-player bracket requires a first player");
    }
    await expect(
      acceptDuelEventRegistration(db, {
        guildId: GUILD_ID,
        eventId: event.id,
        competitorId: seedOne,
        actorDiscordId: firstPlayer.discordId,
      }),
    ).rejects.toThrow("not accepting registrations");
    expect(firstRound).toHaveLength(1);
    const openingRequest = firstRound[0];
    if (openingRequest === undefined) {
      throw new Error("Five-player bracket requires an opening series");
    }
    const opening = await db.duelSeries.findUniqueOrThrow({
      where: { id: openingRequest.seriesId },
    });
    expect([opening.competitorOneId, opening.competitorTwoId]).toEqual([
      seedFour,
      seedFive,
    ]);
    await db.duelSeries.update({
      where: { id: opening.id },
      data: {
        seriesState: "completed",
        winnerCompetitorId: seedFour,
        advancementKind: "played",
        completedAt: new Date(),
      },
    });

    await advanceDuelEvent(event.id, "dev", db);
    const secondRound = await db.duelSeries.findMany({
      where: { eventId: event.id, bracket: "winners", roundNumber: 2 },
      orderBy: { position: "asc" },
    });
    expect(
      secondRound.map((series) => [
        series.competitorOneId,
        series.competitorTwoId,
      ]),
    ).toEqual([
      [seedOne, seedFour],
      [seedTwo, seedThree],
    ]);
    expect(vi.mocked(launchDuelSeries)).toHaveBeenCalledTimes(2);

    await advanceDuelEvent(event.id, "dev", db);
    expect(
      await db.duelSeries.count({
        where: { eventId: event.id, bracket: "winners", roundNumber: 2 },
      }),
    ).toBe(2);
  });
});
