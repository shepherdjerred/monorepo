import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { MatchLakeRow, PrematchLakeRow } from "#src/report-lake/schema.ts";
import {
  ACCOUNT_LAKE_COLUMNS,
  duckDbColumnsSpec,
  lakeMonth,
  lakeTimestamp,
  type AccountLakeRow,
} from "#src/report-lake/schema.ts";
import {
  buildDirPath,
  ensureLakeScaffold,
  publishBuild,
} from "#src/report-lake/paths.ts";
import {
  matchStagingFilePath,
  prematchStagingFilePath,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

/**
 * Test helper: build a minimal report lake from simplified fact inputs.
 *
 * Accounts land in a published build (the engine only reads the accounts
 * dimension from parquet); match/prematch rows land as staging NDJSON, which
 * exercises the union path. Parquet match data is covered by the compactor
 * integration tests and the parity suite (which seeds via full compaction).
 */

export type TestLakeMatchFact = {
  playerId: number;
  playerAlias: string;
  discordId?: string | null;
  matchId: string;
  puuid: string;
  queue: string | null;
  win: boolean;
  surrendered: boolean;
  kills: number;
  deaths: number;
  assists: number;
  teamId?: number;
  /** Arena subteam (1-8); leave unset for non-Arena queues. */
  playerSubteamId?: number;
  championId?: number;
  championName?: string;
  gameCreationAt: Date;
};

export type TestLakePrematchFact = {
  playerId: number;
  playerAlias: string;
  discordId?: string | null;
  dedupeKey: string;
  puuid: string;
  queue: string | null;
  championId?: number;
  observedAt: Date;
  teamId?: number;
};

let testBuildCounter = 0;

function matchRowFromFact(fact: TestLakeMatchFact): MatchLakeRow {
  const created = fact.gameCreationAt.getTime();
  return {
    match_id: fact.matchId,
    game_id: fact.matchId.replaceAll(/\D/g, "") || "0",
    platform_id: "NA1",
    month: lakeMonth(created),
    game_creation_at: lakeTimestamp(created),
    game_start_at: lakeTimestamp(created),
    game_end_at: lakeTimestamp(created + 1_800_000),
    game_duration_seconds: 1800,
    queue_id: 420,
    queue: fact.queue,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_version: "16.1.1",
    map_id: 11,
    puuid: fact.puuid,
    participant_id: fact.playerId,
    team_id: fact.teamId ?? 100,
    riot_id_game_name: fact.playerAlias,
    riot_id_tagline: "NA1",
    summoner_name: fact.playerAlias,
    champion_id: fact.championId ?? 22,
    champion_name: fact.championName ?? "Ashe",
    team_position: "BOTTOM",
    individual_position: "BOTTOM",
    lane: null,
    role: null,
    win: fact.win,
    surrendered: fact.surrendered,
    early_surrendered: false,
    game_ended_in_surrender: fact.surrendered,
    game_ended_in_early_surrender: false,
    team_early_surrendered: false,
    kills: fact.kills,
    deaths: fact.deaths,
    assists: fact.assists,
    kda:
      fact.deaths === 0
        ? fact.kills + fact.assists
        : (fact.kills + fact.assists) / fact.deaths,
    creep_score: 150,
    total_minions_killed: 140,
    neutral_minions_killed: 10,
    gold_earned: 10_000,
    gold_spent: 9500,
    total_damage_dealt: 50_000,
    total_damage_dealt_to_champions: 12_000,
    total_damage_taken: 20_000,
    damage_self_mitigated: 8000,
    damage_dealt_to_objectives: 4000,
    damage_dealt_to_turrets: 2000,
    total_heal: 3000,
    total_heals_on_teammates: 500,
    vision_score: 20,
    wards_placed: 10,
    wards_killed: 3,
    vision_wards_bought_in_game: 2,
    detector_wards_placed: 2,
    double_kills: 1,
    triple_kills: 0,
    quadra_kills: 0,
    penta_kills: 0,
    largest_multi_kill: 2,
    killing_sprees: 1,
    first_blood_kill: false,
    champ_level: 16,
    champ_experience: 15_000,
    time_played: 1800,
    total_time_spent_dead: 120,
    longest_time_spent_living: 700,
    time_ccing_others: 25,
    turret_kills: 1,
    inhibitor_kills: 0,
    baron_kills: 0,
    dragon_kills: 0,
    placement: null,
    subteam_placement: null,
    player_subteam_id: fact.playerSubteamId ?? null,
  };
}

function prematchRowFromFact(fact: TestLakePrematchFact): PrematchLakeRow {
  const observed = fact.observedAt.getTime();
  return {
    dedupe_key: fact.dedupeKey,
    game_id: fact.dedupeKey.replaceAll(/\D/g, "") || "0",
    platform_id: "NA1",
    month: lakeMonth(observed),
    observed_at: lakeTimestamp(observed),
    game_start_at: null,
    queue_id: 420,
    queue: fact.queue,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    map_id: 11,
    puuid: fact.puuid,
    team_id: fact.teamId ?? 100,
    player_subteam_id: null,
    champion_id: fact.championId ?? 22,
    riot_id: `${fact.playerAlias}#NA1`,
    summoner_name: fact.playerAlias,
    selected_skin_index: 0,
    bot: false,
  };
}

/** Wipe every build and staging file so tests start from an empty lake. */
export async function resetTestLake(lakeDir: string): Promise<void> {
  await rm(lakeDir, { recursive: true, force: true });
  await ensureLakeScaffold(lakeDir);
}

export async function writeTestLake(
  lakeDir: string,
  input: {
    serverId: string;
    matchFacts?: TestLakeMatchFact[];
    prematchFacts?: TestLakePrematchFact[];
  },
): Promise<void> {
  await ensureLakeScaffold(lakeDir);

  // Accounts dimension: one account per distinct (playerId, puuid).
  const accountsByKey = new Map<string, AccountLakeRow>();
  const allFacts = [
    ...(input.matchFacts ?? []),
    ...(input.prematchFacts ?? []),
  ];
  for (const fact of allFacts) {
    const key = `${fact.playerId.toString()}:${fact.puuid}`;
    accountsByKey.set(key, {
      server_id: input.serverId,
      puuid: fact.puuid,
      account_id: fact.playerId,
      account_alias: fact.playerAlias,
      region: "AMERICA_NORTH",
      player_id: fact.playerId,
      player_alias: fact.playerAlias,
      discord_id: fact.discordId ?? null,
    });
  }

  testBuildCounter += 1;
  const buildId = `test-${testBuildCounter.toString().padStart(4, "0")}`;
  const buildDir = buildDirPath(lakeDir, buildId);
  const accountsDir = path.join(buildDir, "accounts");
  await mkdir(accountsDir, { recursive: true });

  const accountsNdjson = path.join(buildDir, "accounts.ndjson.tmp");
  await Bun.write(
    accountsNdjson,
    [...accountsByKey.values()].map((row) => JSON.stringify(row)).join("\n") +
      "\n",
  );
  await withDuckDBConnection(async (session) => {
    await session.run(
      `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(ACCOUNT_LAKE_COLUMNS)})) TO '${path.join(accountsDir, "accounts.parquet")}' (FORMAT PARQUET)`,
      [accountsNdjson],
    );
  });
  await rm(accountsNdjson);
  await publishBuild(lakeDir, buildId);

  // Match rows: one staging file per matchId (exercises the union path).
  const byMatch = new Map<string, MatchLakeRow[]>();
  for (const fact of input.matchFacts ?? []) {
    const rows = byMatch.get(fact.matchId) ?? [];
    rows.push(matchRowFromFact(fact));
    byMatch.set(fact.matchId, rows);
  }
  for (const [matchId, rows] of byMatch) {
    await Bun.write(
      matchStagingFilePath(lakeDir, matchId),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }

  const byPrematch = new Map<string, PrematchLakeRow[]>();
  for (const fact of input.prematchFacts ?? []) {
    const rows = byPrematch.get(fact.dedupeKey) ?? [];
    rows.push(prematchRowFromFact(fact));
    byPrematch.set(fact.dedupeKey, rows);
  }
  for (const [dedupeKey, rows] of byPrematch) {
    await Bun.write(
      prematchStagingFilePath(lakeDir, dedupeKey),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}
