import { beforeEach, describe, expect, test } from "vitest";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  fetchPlayerChampionPool,
  fetchPlayerMatchHistory,
  fetchTeamTotalsForMatches,
} from "#src/reports/duckdb/lake-reads.ts";

/**
 * Profile reads run over the raw matches table with no accounts join, so the
 * properties guarded here are the ones nothing downstream would catch:
 *
 *  - a Scout Player owns several accounts, and the profile must aggregate them
 *    as one person (the thing op.gg structurally cannot do);
 *  - team denominators must see participants the requesting player is not,
 *    which only works because the team query filters on match_id alone.
 */

const lakeDir = resolveLakeDir();
const serverId = testGuildId("515151");
const base = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));

const MAIN = testPuuid("profile-main");
const SMURF = testPuuid("profile-smurf");

function at(offsetMinutes: number): Date {
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

type FactOverrides = {
  puuid?: string;
  win?: boolean;
  kills?: number;
  championId?: number;
  championName?: string;
  teamId?: number;
  totalDamageDealtToChampions?: number;
  playerId?: number;
};

function fact(matchId: string, when: Date, overrides: FactOverrides = {}) {
  return {
    playerId: overrides.playerId ?? 1,
    playerAlias: "Profile Player",
    matchId,
    puuid: overrides.puuid ?? MAIN,
    queue: "solo",
    win: overrides.win ?? true,
    surrendered: false,
    kills: overrides.kills ?? 5,
    deaths: 2,
    assists: 7,
    championId: overrides.championId ?? 22,
    championName: overrides.championName ?? "Ashe",
    teamId: overrides.teamId ?? 100,
    totalDamageDealtToChampions:
      overrides.totalDamageDealtToChampions ?? 12_000,
    gameCreationAt: when,
  };
}

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

describe("fetchPlayerMatchHistory", () => {
  test("returns one row per match, newest first", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_1", at(0)),
        fact("NA1_2", at(60)),
        fact("NA1_3", at(120)),
      ],
    });

    const rows = await fetchPlayerMatchHistory({
      puuids: [MAIN],
      limit: 10,
      lakeDir,
    });

    expect(rows.map((row) => row.match_id)).toEqual([
      "NA1_3",
      "NA1_2",
      "NA1_1",
    ]);
  });

  test("aggregates every account of one player into a single history", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_main", at(0)),
        fact("NA1_smurf", at(60), { puuid: SMURF }),
      ],
    });

    const bothAccounts = await fetchPlayerMatchHistory({
      puuids: [MAIN, SMURF],
      limit: 10,
      lakeDir,
    });
    const mainOnly = await fetchPlayerMatchHistory({
      puuids: [MAIN],
      limit: 10,
      lakeDir,
    });

    expect(bothAccounts.map((row) => row.match_id)).toEqual([
      "NA1_smurf",
      "NA1_main",
    ]);
    // Passing fewer puuids must narrow the result — this is the whole
    // authorization surface, so it has to actually filter.
    expect(mainOnly.map((row) => row.match_id)).toEqual(["NA1_main"]);
  });

  test("lists a match once when two of the player's puuids appear in it", async () => {
    // mergePlayers can leave one Player holding two PUUIDs that met in a game.
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_merged", at(0), { puuid: MAIN, teamId: 100 }),
        fact("NA1_merged", at(0), { puuid: SMURF, teamId: 200, win: false }),
      ],
    });

    const rows = await fetchPlayerMatchHistory({
      puuids: [MAIN, SMURF],
      limit: 10,
      lakeDir,
    });

    expect(rows).toHaveLength(1);
  });

  test("keyset cursor walks pages without repeating or skipping a match", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_1", at(0)),
        fact("NA1_2", at(60)),
        fact("NA1_3", at(120)),
        fact("NA1_4", at(180)),
      ],
    });

    const first = await fetchPlayerMatchHistory({
      puuids: [MAIN],
      limit: 2,
      lakeDir,
    });
    const last = first.at(-1);
    if (last === undefined) throw new Error("expected a first page");

    const second = await fetchPlayerMatchHistory({
      puuids: [MAIN],
      limit: 2,
      cursor: { gameCreationMs: last.game_creation_ms, matchId: last.match_id },
      lakeDir,
    });

    expect(first.map((row) => row.match_id)).toEqual(["NA1_4", "NA1_3"]);
    expect(second.map((row) => row.match_id)).toEqual(["NA1_2", "NA1_1"]);
  });

  test("filters by queue when asked", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_solo", at(0)),
        { ...fact("NA1_aram", at(60)), queue: "aram" },
      ],
    });

    const rows = await fetchPlayerMatchHistory({
      puuids: [MAIN],
      limit: 10,
      queue: "aram",
      lakeDir,
    });

    expect(rows.map((row) => row.match_id)).toEqual(["NA1_aram"]);
  });

  test("returns nothing for an empty puuid list rather than everything", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [fact("NA1_1", at(0))],
    });

    expect(
      await fetchPlayerMatchHistory({ puuids: [], limit: 10, lakeDir }),
    ).toEqual([]);
  });
});

describe("fetchPlayerChampionPool", () => {
  test("totals per champion across every account, most played first", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_1", at(0), { championId: 22, championName: "Ashe" }),
        fact("NA1_2", at(60), {
          championId: 22,
          championName: "Ashe",
          win: false,
        }),
        fact("NA1_3", at(120), {
          puuid: SMURF,
          championId: 22,
          championName: "Ashe",
        }),
        fact("NA1_4", at(180), { championId: 64, championName: "LeeSin" }),
      ],
    });

    const pool = await fetchPlayerChampionPool({
      puuids: [MAIN, SMURF],
      lakeDir,
    });

    expect(pool).toHaveLength(2);
    const [ashe, lee] = pool;
    if (ashe === undefined || lee === undefined) {
      throw new Error("expected two champions");
    }
    expect(ashe.champion_name).toBe("Ashe");
    expect(ashe.games).toBe(3);
    expect(ashe.wins).toBe(2);
    expect(lee.champion_name).toBe("LeeSin");
    expect(lee.games).toBe(1);
  });
});

describe("fetchTeamTotalsForMatches", () => {
  test("sums participants the requesting player cannot see", async () => {
    // The player is one of five; the other four are untracked. A puuid-filtered
    // implementation would return the player's own 5 kills as the team total
    // and make kill participation exactly 1.0 in every game.
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_team", at(0), {
          kills: 5,
          teamId: 100,
          totalDamageDealtToChampions: 10_000,
        }),
      ],
      untrackedMatchFacts: [
        fact("NA1_team", at(0), {
          playerId: 91,
          puuid: testPuuid("ally-a"),
          kills: 3,
          teamId: 100,
          totalDamageDealtToChampions: 5000,
        }),
        fact("NA1_team", at(0), {
          playerId: 92,
          puuid: testPuuid("ally-b"),
          kills: 2,
          teamId: 100,
          totalDamageDealtToChampions: 5000,
        }),
        fact("NA1_team", at(0), {
          playerId: 93,
          puuid: testPuuid("enemy-a"),
          kills: 7,
          teamId: 200,
          totalDamageDealtToChampions: 9000,
          win: false,
        }),
      ],
    });

    const totals = await fetchTeamTotalsForMatches({
      matchIds: ["NA1_team"],
      lakeDir,
    });

    const blue = totals.find((row) => row.team_id === 100);
    const red = totals.find((row) => row.team_id === 200);
    if (blue === undefined || red === undefined) {
      throw new Error("expected both teams");
    }
    expect(blue.team_kills).toBe(10);
    expect(blue.team_damage_to_champions).toBe(20_000);
    // Partitioned per team, not per match.
    expect(red.team_kills).toBe(7);
  });

  test("returns nothing for an empty match list", async () => {
    expect(await fetchTeamTotalsForMatches({ matchIds: [], lakeDir })).toEqual(
      [],
    );
  });
});
