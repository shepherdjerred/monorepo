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
  gameDurationSeconds?: number;
  timePlayedSeconds?: number;
  /** Override to make per-participant damage vary, e.g. for damage-share tests. */
  totalDamageDealtToChampions?: number;
  /** Override to make per-participant CS vary, e.g. for CS-per-minute tests. */
  creepScore?: number;
  teamId?: number;
  /** Arena subteam (1-8); leave unset for non-Arena queues. */
  playerSubteamId?: number;
  championId?: number;
  championName?: string;
  /**
   * The Riot ID recorded on this match row.
   *
   * Defaults to the player alias so existing fixtures are unchanged. Set it
   * per-match to express a rename — one PUUID under several Riot IDs — which
   * is the shape identity resolution exists to handle and which was otherwise
   * inexpressible here.
   */
  riotIdGameName?: string;
  riotIdTagline?: string;
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
  const gameDurationSeconds = fact.gameDurationSeconds ?? 1800;
  const timePlayedSeconds = fact.timePlayedSeconds ?? gameDurationSeconds;
  return {
    match_id: fact.matchId,
    game_id: fact.matchId.replaceAll(/\D/g, "") || "0",
    platform_id: "NA1",
    month: lakeMonth(created),
    game_creation_at: lakeTimestamp(created),
    game_start_at: lakeTimestamp(created),
    game_end_at: lakeTimestamp(created + gameDurationSeconds * 1000),
    game_duration_seconds: gameDurationSeconds,
    queue_id: 420,
    queue: fact.queue,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_version: "16.1.1",
    end_of_game_result: "GameComplete",
    map_id: 11,
    puuid: fact.puuid,
    participant_id: fact.playerId,
    team_id: fact.teamId ?? 100,
    riot_id_game_name: fact.riotIdGameName ?? fact.playerAlias,
    riot_id_tagline: fact.riotIdTagline ?? "NA1",
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
    creep_score: fact.creepScore ?? 150,
    total_minions_killed: 140,
    neutral_minions_killed: 10,
    gold_earned: 10_000,
    gold_spent: 9500,
    total_damage_dealt: 50_000,
    total_damage_dealt_to_champions: fact.totalDamageDealtToChampions ?? 12_000,
    magic_damage_dealt_to_champions: 5000,
    physical_damage_dealt_to_champions: 6000,
    true_damage_dealt_to_champions: 1000,
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
    all_in_pings: 3,
    assist_me_pings: 4,
    basic_pings: 12,
    command_pings: 2,
    danger_pings: 5,
    enemy_missing_pings: 9,
    enemy_vision_pings: 1,
    get_back_pings: 2,
    hold_pings: 1,
    need_vision_pings: 3,
    on_my_way_pings: 6,
    push_pings: 2,
    vision_cleared_pings: 1,
    double_kills: 1,
    triple_kills: 0,
    quadra_kills: 0,
    penta_kills: 0,
    largest_multi_kill: 2,
    killing_sprees: 1,
    first_blood_kill: false,
    champ_level: 16,
    champ_experience: 15_000,
    time_played: timePlayedSeconds,
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
    /**
     * Additional servers that also track every account above, producing a
     * second accounts row per (server, account) exactly as the compactor does.
     * This is the shape that makes an unscoped accounts join double-count, so
     * global-scope tests need it to be meaningful.
     */
    alsoTrackedBy?: string[];
    /**
     * Match facts written to the lake but deliberately absent from the accounts
     * dimension — the other nine participants of a game Scout ingested for one
     * tracked player. Guild scope must not see them; global scope must.
     */
    untrackedMatchFacts?: TestLakeMatchFact[];
  },
): Promise<void> {
  await ensureLakeScaffold(lakeDir);

  // Accounts dimension: one account per distinct (server, playerId, puuid).
  const accountsByKey = new Map<string, AccountLakeRow>();
  const allFacts = [
    ...(input.matchFacts ?? []),
    ...(input.prematchFacts ?? []),
  ];
  const accountServerIds = [input.serverId, ...(input.alsoTrackedBy ?? [])];
  for (const fact of allFacts) {
    for (const serverId of accountServerIds) {
      const key = `${serverId}:${fact.playerId.toString()}:${fact.puuid}`;
      accountsByKey.set(key, {
        server_id: serverId,
        puuid: fact.puuid,
        account_id: fact.playerId,
        account_alias: fact.playerAlias,
        region: "AMERICA_NORTH",
        player_id: fact.playerId,
        player_alias: fact.playerAlias,
        discord_id: fact.discordId ?? null,
      });
    }
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
  // Untracked facts are written alongside tracked ones — the lake makes no
  // distinction; only the accounts dimension above does.
  const byMatch = new Map<string, MatchLakeRow[]>();
  for (const fact of [
    ...(input.matchFacts ?? []),
    ...(input.untrackedMatchFacts ?? []),
  ]) {
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
