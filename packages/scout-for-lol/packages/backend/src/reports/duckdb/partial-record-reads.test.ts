import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid, MatchCoverage } from "@scout-for-lol/data";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fetchGuildAccountCounts,
  fetchGuildMatchRows,
} from "#src/reports/duckdb/community/community-lake.ts";
import { fetchHistoryRosters } from "#src/reports/duckdb/community/history-roster.ts";
import { fetchMatchLoadoutRows } from "#src/reports/duckdb/consumer/match-loadout-lake-reads.ts";
import { fetchPlayerMatchHistory } from "#src/reports/duckdb/lake-reads.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import {
  resetTestLake,
  writeTestLake,
} from "#src/testing/report-lake/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * Lake readers over the Scout Client's partial records: an end-of-game record
 * states no lobby creation time and numbers no participant, and a history
 * record states no time played. Each reader must read them as unknowns, not
 * fail on them or drop them from a window.
 */
const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-partial-records-"));
const guildId = testGuildId("737373");
const OWNER = testPuuid("partial-owner");
const MATE = testPuuid("partial-mate");
const endOfGameId = RiotMatchIdSchema.parse("NA1_7500000002");
const historyId = RiotMatchIdSchema.parse("NA1_7500000003");
const endOfGameStart = new Date("2026-11-21T20:00:00Z");
const historyCreated = new Date("2026-11-20T20:00:00Z");

function mayhemRow(options: {
  puuid: LeaguePuuid;
  matchId: RiotMatchId;
  coverage: MatchCoverage;
  created: Date;
}) {
  const owner = options.puuid === OWNER;
  return {
    playerId: owner ? 1 : 2,
    playerAlias: owner ? "Partial Owner" : "Partial Mate",
    riotIdGameName: owner ? "Partial Owner" : "Only Seen Live",
    matchId: options.matchId,
    puuid: options.puuid,
    queue: "aram mayhem",
    queueId: 2400,
    gameMode: "ARAM",
    mapId: 12,
    teamPosition: "",
    win: owner,
    surrendered: false,
    kills: 4,
    deaths: 3,
    assists: 9,
    teamId: 100,
    championId: owner ? 22 : 1,
    championName: owner ? "Ashe" : "Annie",
    gameDurationSeconds: 1200,
    coverage: options.coverage,
    gameCreationAt: options.created,
  };
}

beforeAll(async () => {
  await resetTestLake(lakeDir);
  await writeTestLake(lakeDir, {
    serverId: guildId,
    matchFacts: [
      ...[OWNER, MATE].map((puuid) =>
        mayhemRow({
          puuid,
          matchId: endOfGameId,
          coverage: "end_of_game",
          created: endOfGameStart,
        }),
      ),
      mayhemRow({
        puuid: OWNER,
        matchId: historyId,
        coverage: "history",
        created: historyCreated,
      }),
    ],
  });
});

afterAll(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("lake reads over partial records", () => {
  test("profile history places an end-of-game record at its start and times a history record by its length", async () => {
    const rows = await fetchPlayerMatchHistory({ puuids: [OWNER], lakeDir });
    expect(
      rows.map((row) => [row.match_id, row.game_creation_ms, row.time_played]),
    ).toEqual([
      [endOfGameId, endOfGameStart.getTime(), 1200],
      [historyId, historyCreated.getTime(), 1200],
    ]);
    const windowed = await fetchPlayerMatchHistory({
      puuids: [OWNER],
      afterMs: endOfGameStart.getTime(),
      lakeDir,
    });
    expect(windowed.map((row) => row.match_id)).toEqual([endOfGameId]);
  });

  test("guild reads keep an end-of-game record's unnumbered roster", async () => {
    const rows = await fetchGuildMatchRows({
      puuids: [OWNER],
      afterMs: endOfGameStart.getTime(),
      lakeDir,
    });
    expect(
      rows.map((row) => [
        row.match_id,
        row.game_creation_ms,
        row.participant_id,
        row.champion_name,
      ]),
    ).toEqual([
      [endOfGameId, endOfGameStart.getTime(), null, "Annie"],
      [endOfGameId, endOfGameStart.getTime(), null, "Ashe"],
    ]);
    const counts = await fetchGuildAccountCounts({ puuids: [OWNER], lakeDir });
    expect(counts).toEqual([
      { puuid: OWNER, games: 2, last_match_ms: endOfGameStart.getTime() },
    ]);
  });

  test("match-history rosters and Explore loadouts read an unnumbered participant", async () => {
    const rosters = await fetchHistoryRosters({
      matchIds: [endOfGameId],
      lakeDir,
    });
    expect(
      rosters.map((row) => [row.participant_id, row.champion_name]),
    ).toEqual([
      [null, "Annie"],
      [null, "Ashe"],
    ]);
    const loadouts = await fetchMatchLoadoutRows({
      matchId: endOfGameId,
      lakeDir,
    });
    expect(
      loadouts.map((row) => [row.participant_id, row.champion_name]),
    ).toEqual([
      [null, "Annie"],
      [null, "Ashe"],
    ]);
  });

  test("a Riot ID seen only in an end-of-game record resolves with its start as when it was seen", async () => {
    const found = await resolvePlayerIdentities({
      query: "Only Seen Live#NA1",
      guildIds: [],
      lakeDir,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.games).toBe(1);
    expect(found[0]?.firstSeen).toContain("2026-11-21 20:00:00");
    expect(found[0]?.lastSeen).toContain("2026-11-21 20:00:00");
  });
});
