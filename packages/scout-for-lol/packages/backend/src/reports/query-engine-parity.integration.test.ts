import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  LeaguePuuidSchema,
  RawMatchSchema,
  type LeaguePuuid,
  type RawCurrentGameInfo,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { runReportLakeRebuild } from "#src/report-lake/compactor.ts";
import { resetTestLake } from "#src/testing/test-report-lake.ts";
import {
  upsertStoredMatchWithFacts,
  upsertStoredPrematchWithFacts,
} from "#src/report-store/store.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { executeReportQueryLegacy } from "#src/reports/query-engine-legacy.ts";

/**
 * Parity suite: the lake/DuckDB engine must produce byte-identical
 * ReportQueryResult to the legacy fact-table engine for every fact-style
 * source, seeded through the REAL ingest path (upsertStored*WithFacts writes
 * facts for legacy AND staging/Stored* for the lake, then a full rebuild
 * compacts the lake).
 *
 * Accepted, deliberate differences (not covered here):
 * - alias/discordId snapshots: facts freeze at ingest, the lake joins the
 *   live accounts snapshot (both agree in this suite since nothing renames);
 * - pair dedupe when one player has two tracked accounts in one match picks
 *   a deterministic row instead of the last-processed fact.
 */

const { prisma } = createTestDatabase("report-parity-test");
const serverId = testGuildId("929292");
const now = new Date(Date.UTC(2025, 9, 15, 12, 0, 0)); // fixture is 2025-09-19
const lakeDir = resolveLakeDir();

let championIdOfTracked = 0;

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

function matchVariant(
  base: RawMatch,
  overrides: { matchId: string; gameCreation: Date; queueId?: number },
): RawMatch {
  const clone = structuredClone(base);
  clone.metadata.matchId = overrides.matchId;
  clone.info.gameCreation = overrides.gameCreation.getTime();
  clone.info.gameStartTimestamp = overrides.gameCreation.getTime();
  clone.info.gameEndTimestamp =
    overrides.gameCreation.getTime() + clone.info.gameDuration * 1000;
  if (overrides.queueId !== undefined) {
    clone.info.queueId = overrides.queueId;
  }
  return clone;
}

async function createTrackedPlayer(alias: string, puuid: LeaguePuuid) {
  const timestamp = new Date();
  const player = await prisma.player.create({
    data: {
      alias,
      discordId: testAccountId(
        `92${alias.length.toString()}${(alias.codePointAt(0) ?? 0).toString()}`,
      ),
      serverId,
      creatorDiscordId: testAccountId("929292"),
      createdTime: timestamp,
      updatedTime: timestamp,
    },
  });
  await prisma.account.create({
    data: {
      alias,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: testAccountId("929292"),
      createdTime: timestamp,
      updatedTime: timestamp,
    },
  });
}

beforeAll(async () => {
  await resetTestLake(lakeDir);
  const fixture = await loadMatchFixture();
  const participants = fixture.info.participants;
  const first = participants[0];
  if (first === undefined) {
    throw new Error("fixture has no participants");
  }
  const teammate = participants.find(
    (candidate) =>
      candidate.teamId === first.teamId && candidate.puuid !== first.puuid,
  );
  const opponent = participants.find(
    (candidate) => candidate.teamId !== first.teamId,
  );
  if (teammate === undefined || opponent === undefined) {
    throw new Error("fixture lacks teammate/opponent");
  }
  championIdOfTracked = first.championId;

  await createTrackedPlayer("Alpha", LeaguePuuidSchema.parse(first.puuid));
  await createTrackedPlayer("Bravo", LeaguePuuidSchema.parse(teammate.puuid));
  await createTrackedPlayer("Céline", LeaguePuuidSchema.parse(opponent.puuid));

  // Ingest through the real path: facts for the legacy engine, staging +
  // StoredMatch for the lake.
  const day = 24 * 60 * 60 * 1000;
  const variants = [
    {
      matchId: "NA1_parity_1",
      gameCreation: new Date(now.getTime() - 2 * day),
      queueId: 420,
    },
    {
      matchId: "NA1_parity_2",
      gameCreation: new Date(now.getTime() - 5 * day),
      queueId: 420,
    },
    {
      matchId: "NA1_parity_3",
      gameCreation: new Date(now.getTime() - 9 * day),
      queueId: 440,
    },
    {
      matchId: "NA1_parity_4",
      gameCreation: new Date(now.getTime() - 20 * day),
    },
    // Outside the 30-day lookback window:
    {
      matchId: "NA1_parity_old",
      gameCreation: new Date(now.getTime() - 45 * day),
      queueId: 420,
    },
  ];
  for (const variant of variants) {
    await upsertStoredMatchWithFacts(prisma, matchVariant(fixture, variant));
  }

  const prematch: RawCurrentGameInfo = {
    gameId: 5555,
    gameStartTime: now.getTime() - day,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: 300,
    platformId: "NA1",
    participants: [first, teammate, opponent].map((participant, index) => ({
      championId: participant.championId,
      puuid: participant.puuid,
      teamId: index < 2 ? 100 : 200,
      riotId: `Parity${index.toString()}#NA1`,
      spell1Id: 4,
      spell2Id: 7,
      lastSelectedSkinIndex: 0,
      bot: false,
      profileIconId: 1,
    })),
    bannedChampions: [],
  };
  await upsertStoredPrematchWithFacts(
    prisma,
    prematch,
    new Date(now.getTime() - day),
  );

  const summary = await runReportLakeRebuild({ prisma, lakeDir });
  if (summary === null || summary.skippedMatches > 0) {
    throw new Error("parity lake rebuild failed or skipped rows");
  }
});

afterAll(async () => {
  await deleteIfExists(() => prisma.prematchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedPrematch.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedMatch.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
  await prisma.$disconnect();
});

async function expectParity(queryText: string, maxRows = 25): Promise<void> {
  const params = {
    prisma,
    serverId,
    queryText,
    lookbackDays: 30,
    maxRows,
    now,
  };
  const [lake, legacy] = [
    await executeReportQuery(params),
    await executeReportQueryLegacy(params),
  ];
  expect(lake).toEqual(legacy);
}

describe("lake engine parity with legacy fact engine", () => {
  test("players: all base metrics", async () => {
    await expectParity(
      "SELECT player, games, wins, losses, win_rate, surrenders, surrender_rate, kills, deaths, assists, kda, creep_score, damage_to_champions FROM match_participants GROUP BY player ORDER BY games DESC",
    );
  });

  test("players: queue filter", async () => {
    await expectParity(
      "SELECT player, games, wins, win_rate FROM match_participants WHERE queue IN ('solo') GROUP BY player ORDER BY games DESC",
    );
  });

  test("players: champion filter (rowsScanned asymmetry, match side)", async () => {
    await expectParity(
      `SELECT player, games, kills FROM match_participants WHERE champion_id = ${championIdOfTracked.toString()} GROUP BY player ORDER BY kills DESC`,
    );
  });

  test("players: min games HAVING", async () => {
    await expectParity(
      "SELECT player, games, wins FROM match_participants WHERE games >= 3 GROUP BY player ORDER BY games DESC",
    );
  });

  test("players: order by label ascending (localeCompare tiebreak)", async () => {
    await expectParity(
      "SELECT player, games FROM match_participants GROUP BY player ORDER BY label ASC",
    );
  });

  test("players: limit cap interplay", async () => {
    await expectParity(
      "SELECT player, games FROM match_participants GROUP BY player ORDER BY games DESC LIMIT 50",
      2,
    );
  });

  test("champions grouping", async () => {
    await expectParity(
      "SELECT champion, games, kills, deaths, assists, kda FROM match_participants GROUP BY champion ORDER BY kills DESC",
    );
  });

  test("queues grouping", async () => {
    await expectParity(
      "SELECT queue, games, win_rate FROM match_participants GROUP BY queue ORDER BY games DESC",
    );
  });

  test("empty result set", async () => {
    await expectParity(
      "SELECT player, games FROM match_participants WHERE queue IN ('clash') GROUP BY player",
    );
  });

  test("pairs: base", async () => {
    await expectParity(
      "SELECT pair, games, wins, win_rate, kills, deaths, assists, surrenders FROM player_pairs GROUP BY pair ORDER BY games DESC",
    );
  });

  test("pairs: queue filter", async () => {
    await expectParity(
      "SELECT pair, games, wins FROM player_pairs WHERE queue IN ('solo') GROUP BY pair ORDER BY games DESC",
    );
  });

  test("prematch: players", async () => {
    await expectParity(
      "SELECT player, prematches FROM prematch_participants GROUP BY player ORDER BY prematches DESC",
    );
  });

  test("prematch: champion grouping labels by id", async () => {
    await expectParity(
      "SELECT champion, prematches FROM prematch_participants GROUP BY champion ORDER BY prematches DESC",
    );
  });

  test("prematch: champion filter (rowsScanned asymmetry, prematch side)", async () => {
    await expectParity(
      `SELECT player, prematches FROM prematch_participants WHERE champion_id = ${championIdOfTracked.toString()} GROUP BY player`,
    );
  });
});
