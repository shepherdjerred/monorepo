import {
  computeKda,
  type DiscordAccountId,
  type LeaguePuuid,
  type MatchLakeRow,
  type MatchLoadout,
  type MatchTeamLakeRow,
  type PrematchLakeRow,
  type RiotMatchId,
  type RUNE_SPELL_COLUMNS,
} from "@scout-for-lol/data";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import { matchLoadoutLakeFields } from "#src/report-lake/loadout.ts";
import {
  augmentFields,
  DEFAULT_SCOUTQL_LOADOUT,
  itemSlots,
} from "#src/testing/report-lake/match-fields.ts";

/**
 * The simplified facts a test lake is written from, and the lake rows each
 * becomes. `test-report-lake.ts` writes them; tests describe their data with
 * the fact types.
 */

export type TestLakeMatchFact = {
  playerId: number;
  playerAlias: string;
  /** Servers whose accounts dimension contains this fact; defaults to the
   * write's primary and also-tracked servers. */
  accountServerIds?: string[];
  /** Account-specific alias; defaults to the owning player's Scout alias. */
  accountAlias?: string;
  discordId?: DiscordAccountId | null;
  matchId: RiotMatchId;
  puuid: LeaguePuuid;
  queue: string | null;
  queueId?: number;
  gameMode?: string;
  mapId?: number;
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
  /** Team objective flags for the match_teams row this fact rolls up into. */
  firstDragon?: boolean;
  firstBaron?: boolean;
  /** Arena subteam (1-8); leave unset for non-Arena queues. */
  playerSubteamId?: number;
  placement?: number;
  subteamPlacement?: number;
  augmentIds?: readonly (number | null)[];
  championId?: number;
  championName?: string;
  teamPosition?: string | undefined;
  loadout?: MatchLoadout;
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
  /** Final inventory by slot (0-6); missing slots are empty. */
  items?: number[];
  /** ScoutQL spell/rune ids; defaults to Flash + Ignite, Conqueror. */
  scoutQlLoadout?: Partial<
    Pick<MatchLakeRow, (typeof RUNE_SPELL_COLUMNS)[number]>
  >;
  gameCreationAt: Date;
};

export type TestLakePrematchFact = {
  playerId: number;
  playerAlias: string;
  /** Servers whose accounts dimension contains this fact; defaults to the
   * write's primary and also-tracked servers. */
  accountServerIds?: string[];
  accountAlias?: string;
  discordId?: DiscordAccountId | null;
  dedupeKey: string;
  puuid: LeaguePuuid;
  queue: string | null;
  championId?: number;
  observedAt: Date;
  teamId?: number;
};

export function matchRowFromFact(fact: TestLakeMatchFact): MatchLakeRow {
  const created = fact.gameCreationAt.getTime();
  const gameDurationSeconds = fact.gameDurationSeconds ?? 1800;
  const timePlayedSeconds = fact.timePlayedSeconds ?? gameDurationSeconds;
  const loadout = fact.loadout ?? {
    itemIds: [1055, 3006, 3031, 3094, 3072, 0, 3340],
    summonerSpellIds: [4, 7],
    runes: {
      primaryStyleId: 8000,
      primaryRuneIds: [8005, 8009, 9103, 8014],
      secondaryStyleId: 8300,
      secondaryRuneIds: [8304, 8347],
      statShardIds: { offense: 5005, flex: 5008, defense: 5002 },
    },
  };
  return {
    match_id: fact.matchId,
    game_id: fact.matchId.replaceAll(/\D/g, "") || "0",
    platform_id: "NA1",
    month: lakeMonth(created),
    game_creation_at: lakeTimestamp(created),
    game_start_at: lakeTimestamp(created),
    game_end_at: lakeTimestamp(created + gameDurationSeconds * 1000),
    game_duration_seconds: gameDurationSeconds,
    queue_id: fact.queueId ?? 420,
    queue: fact.queue,
    game_mode: fact.gameMode ?? "CLASSIC",
    game_type: "MATCHED_GAME",
    game_version: "16.1.1",
    data_source: "RIOT",
    end_of_game_result: "GameComplete",
    map_id: fact.mapId ?? 11,
    puuid: fact.puuid,
    participant_id: fact.playerId,
    team_id: fact.teamId ?? 100,
    riot_id_game_name: fact.riotIdGameName ?? fact.playerAlias,
    riot_id_tagline: fact.riotIdTagline ?? "NA1",
    summoner_name: fact.playerAlias,
    champion_id: fact.championId ?? 22,
    champion_name: fact.championName ?? "Ashe",
    team_position: fact.teamPosition ?? "BOTTOM",
    individual_position: "BOTTOM",
    lane: null,
    role: null,
    ...matchLoadoutLakeFields(loadout),
    win: fact.win,
    surrendered: fact.surrendered,
    early_surrendered: false,
    game_ended_in_surrender: fact.surrendered,
    game_ended_in_early_surrender: false,
    team_early_surrendered: false,
    kills: fact.kills,
    deaths: fact.deaths,
    assists: fact.assists,
    kda: computeKda(fact),
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
    placement: fact.placement ?? null,
    subteam_placement: fact.subteamPlacement ?? null,
    player_subteam_id: fact.playerSubteamId ?? null,
    ...itemSlots(fact.items ?? loadout.itemIds),
    ...augmentFields(fact.augmentIds),
    ...DEFAULT_SCOUTQL_LOADOUT,
    ...fact.scoutQlLoadout,
  };
}

export function teamRowFromFacts(
  matchId: RiotMatchId,
  teamId: number,
  facts: readonly TestLakeMatchFact[],
): MatchTeamLakeRow {
  const first = facts[0];
  if (first === undefined) {
    throw new Error(
      `Test lake team ${String(teamId)} for ${matchId} has no participants`,
    );
  }
  return {
    match_id: matchId,
    month: lakeMonth(first.gameCreationAt.getTime()),
    team_id: teamId,
    win: first.win,
    baron_kills: first.firstBaron === true ? 1 : 0,
    first_baron: first.firstBaron ?? false,
    champion_kills: facts.reduce((sum, fact) => sum + fact.kills, 0),
    first_champion_kill: false,
    dragon_kills: first.firstDragon === true ? 1 : 0,
    first_dragon: first.firstDragon ?? false,
    inhibitor_kills: 0,
    first_inhibitor: false,
    rift_herald_kills: 0,
    first_rift_herald: false,
    tower_kills: 1,
    first_tower: false,
    void_grub_kills: null,
    first_void_grub: null,
    atakhan_kills: null,
    first_atakhan: null,
    epic_monster_feat_state: null,
    first_blood_feat_state: null,
    first_turret_feat_state: null,
  };
}

export function prematchRowFromFact(
  fact: TestLakePrematchFact,
): PrematchLakeRow {
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
