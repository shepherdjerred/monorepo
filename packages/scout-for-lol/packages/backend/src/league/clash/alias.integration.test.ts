import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
  RiotMatchIdSchema,
  type RawMatch,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTrackedTestPlayer } from "#src/testing/league-fixtures.ts";

const { prisma } = createTestDatabase("clash-alias");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));
vi.doMock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isFeatureHardDisabled: () => false,
}));

const {
  clashClientShadowedByRiot,
  resolveRiotClashDiscovery,
  withoutClashAliases,
  clashAliasAdmissions,
} = await import("./alias.ts");
const { recordClashGameIdentity, CLASH_ALIAS_WINDOW_MS } =
  await import("./identity.ts");
const { mergeClashAliasSightings, upsertClashGameSighting } =
  await import("./sighting.ts");
const { readClashHistoryForGuild } = await import("./history.ts");
const { admitMatchEvidence } = await import("#src/evidence/admission.ts");

const RIFT = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const GUILD = DiscordGuildIdSchema.parse("1100000000000000001");
const PLAYER = LeaguePuuidSchema.parse(RIFT.info.participants[0]?.puuid);
const LIVE_GAME_ID = "5645340874";
const LIVE_MATCH_ID = RiotMatchIdSchema.parse(`NA1_${LIVE_GAME_ID}`);
const RIOT_MATCH_ID = RiotMatchIdSchema.parse("NA1_5421167767");
const START = new Date(RIFT.info.gameStartTimestamp);

const NONE_SETTLED = new Map<RiotMatchId, null>();

/** What discovery fetched this pass: at most Riot's payload for one id. */
function discovered(match?: RawMatch): Map<RiotMatchId, RawMatch> {
  return new Map(match === undefined ? [] : [[RIOT_MATCH_ID, match]]);
}

/** Riot's later publication of the live Clash game, under its own id. */
function riotClash(matchId: RiotMatchId = RIOT_MATCH_ID): RawMatch {
  return {
    ...RIFT,
    metadata: { ...RIFT.metadata, matchId },
    info: { ...RIFT.info, queueId: 700 },
  };
}

async function recordLiveGame(startAt = START): Promise<void> {
  await recordClashGameIdentity({
    platform: "NA1",
    gameId: LIVE_GAME_ID,
    queueId: 700,
    participants: RIFT.info.participants,
    startAt,
  });
}

/** The client's report of the live game: its admission is the canonical record. */
async function reportFromClient(): Promise<void> {
  await admitMatchEvidence({
    matchId: LIVE_MATCH_ID,
    completedAt: RIFT.info.gameEndTimestamp,
    historical: false,
  });
}

function sighting(gameId: string, source: "prematch" | "match") {
  return {
    platform: "NA1" as const,
    gameId,
    puuid: PLAYER,
    source,
    resultSource: "RIOT" as const,
    queue: "clash" as const,
    championId: RIFT.info.participants[0]?.championId ?? 0,
    teamId: 100,
    observedAt: START,
    win: source === "match" ? true : null,
  };
}

beforeEach(async () => {
  await prisma.clashGameSighting.deleteMany();
  await prisma.clashGameIdentity.deleteMany();
  await prisma.matchEvidenceAdmission.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Riot discovery of a Clash match", () => {
  test("a match with no live game near its start is a miss", async () => {
    await recordLiveGame(new Date(START.getTime() - CLASH_ALIAS_WINDOW_MS - 1));
    await expect(resolveRiotClashDiscovery(riotClash())).resolves.toEqual({
      kind: "miss",
    });
    const identity = await prisma.clashGameIdentity.findFirstOrThrow();
    expect(identity.riotMatchId).toBeNull();
  });

  test("a live game with no client data is aliased and processed", async () => {
    await recordLiveGame();
    await expect(resolveRiotClashDiscovery(riotClash())).resolves.toEqual({
      kind: "alias-and-process",
      canonicalMatchId: LIVE_MATCH_ID,
    });
    const identity = await prisma.clashGameIdentity.findFirstOrThrow();
    expect(identity.riotMatchId).toBe(RIOT_MATCH_ID);
    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: RIOT_MATCH_ID },
      }),
    ).toBeNull();
  });

  test("a game the client already reported admits Riot's id as an alias only", async () => {
    await recordLiveGame();
    await reportFromClient();
    await expect(resolveRiotClashDiscovery(riotClash())).resolves.toEqual({
      kind: "alias-only",
      canonicalMatchId: LIVE_MATCH_ID,
    });
    const admission = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
      where: { riotMatchId: RIOT_MATCH_ID },
    });
    expect(admission).toMatchObject({
      policy: "HISTORY_ONLY",
      reason: "clash-alias",
      historyReportComplete: true,
      historyTimelineRecovered: true,
    });
  });

  test("a Clash game reported by the client and Riot reaches the pipeline once", async () => {
    await recordLiveGame();
    await reportFromClient();
    const intents = [{ matchId: RIOT_MATCH_ID }];
    const fetched = discovered(riotClash());
    // The first pass settles Riot's id as an alias and drops it.
    await expect(
      withoutClashAliases(
        intents,
        fetched,
        await clashAliasAdmissions([RIOT_MATCH_ID]),
      ),
    ).resolves.toEqual([]);
    // Riot keeps listing it; later passes drop it without fetching again.
    const settled = await clashAliasAdmissions([RIOT_MATCH_ID]);
    expect(settled.get(RIOT_MATCH_ID)).toEqual(
      new Date(RIFT.info.gameEndTimestamp),
    );
    await expect(
      withoutClashAliases(intents, discovered(), settled),
    ).resolves.toEqual([]);
    // The client's own run is not shadowed: it is the canonical report.
    await expect(clashClientShadowedByRiot(LIVE_MATCH_ID)).resolves.toBe(false);
  });

  test("a client report after Riot's processed alias starts no second run", async () => {
    await recordLiveGame();
    const intents = [{ matchId: RIOT_MATCH_ID }];
    await expect(
      withoutClashAliases(intents, discovered(riotClash()), NONE_SETTLED),
    ).resolves.toEqual(intents);
    await admitMatchEvidence({
      matchId: RIOT_MATCH_ID,
      completedAt: RIFT.info.gameEndTimestamp,
      historical: false,
      riotHistoryListed: true,
    });
    await expect(clashClientShadowedByRiot(LIVE_MATCH_ID)).resolves.toBe(true);
  });

  test("an ordinary match keeps flowing to the pipeline", async () => {
    const intents = [{ matchId: RIOT_MATCH_ID }];
    await expect(
      withoutClashAliases(intents, discovered(RIFT), NONE_SETTLED),
    ).resolves.toEqual(intents);
    expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
  });
});

describe("Clash sightings across the alias", () => {
  test("merges a duplicate row written under Riot's id, idempotently", async () => {
    await recordLiveGame();
    await upsertClashGameSighting(sighting(LIVE_GAME_ID, "prematch"));
    // Written before the alias existed: today's second history row.
    await upsertClashGameSighting(sighting("5421167767", "match"));
    expect(await prisma.clashGameSighting.count()).toBe(2);
    await prisma.clashGameIdentity.update({
      where: { platform_gameId: { platform: "NA1", gameId: LIVE_GAME_ID } },
      data: { riotMatchId: RIOT_MATCH_ID },
    });
    await expect(mergeClashAliasSightings()).resolves.toBe(1);
    const rows = await prisma.clashGameSighting.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gameId: LIVE_GAME_ID,
      source: "match",
      win: true,
    });
    await expect(mergeClashAliasSightings()).resolves.toBe(0);
    expect(await prisma.clashGameSighting.count()).toBe(1);
  });

  test("a sighting written under a known alias lands on the live game", async () => {
    await recordLiveGame();
    await resolveRiotClashDiscovery(riotClash());
    await upsertClashGameSighting(sighting(LIVE_GAME_ID, "prematch"));
    await upsertClashGameSighting(sighting("5421167767", "match"));
    const rows = await prisma.clashGameSighting.findMany();
    expect(rows.map((row) => [row.gameId, row.source])).toEqual([
      [LIVE_GAME_ID, "match"],
    ]);
  });

  test("history returns one row per game with its match page", async () => {
    await createTrackedTestPlayer(prisma, {
      alias: "Scout Classic",
      serverId: GUILD,
      accounts: [PLAYER],
      creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      createdAt: START,
    });
    await recordLiveGame();
    await upsertClashGameSighting(sighting(LIVE_GAME_ID, "prematch"));
    // A second game, Riot-only and never aliased, still links to itself.
    await upsertClashGameSighting(sighting("5421160000", "match"));
    // Aliased after both sightings were written and before any merge.
    await upsertClashGameSighting(sighting("5421167767", "match"));
    await resolveRiotClashDiscovery(riotClash());
    const cups = await readClashHistoryForGuild(GUILD);
    const rows = cups.flatMap((cup) =>
      cup.players.flatMap((player) => player.sightings),
    );
    expect(
      rows
        .map((row) => [row.gameId, row.outcome, row.matchId])
        .toSorted((left, right) =>
          String(left[0]).localeCompare(String(right[0])),
        ),
    ).toEqual([
      ["5421160000", "win", "NA1_5421160000"],
      // Only Riot processed it, so its page is Riot's id.
      [LIVE_GAME_ID, "win", RIOT_MATCH_ID],
    ]);
  });
});
