import {
  OpponentPingFieldSchema,
  ParticipantNumericFieldSchema,
  TeamObjectiveSchema,
  type OpponentPingField,
  type ParticipantNumericField,
  type TeamObjective,
} from "#src/betting/parlay-catalog.ts";
import type { MatchLakeRow } from "#src/report-lake/schema.ts";

/**
 * Which parlay catalog fields can be priced against recorded history.
 *
 * A parlay leg is only as honest as the data behind its threshold. The model
 * used to pick numbers for fields it had never seen — `visionScore >= 25`
 * against a support whose median is 93 — and those legs backtested at 94%,
 * decorating a parlay while contributing nothing to its outcome. Generation now
 * proposes only fields that appear here with a column, so every threshold is
 * chosen against a real distribution.
 *
 * The map is exhaustive over the whole catalog on purpose. `Record<
 * ParticipantNumericField, ...>` means adding a catalog field is a compile
 * error until someone decides whether it is groundable, rather than silently
 * becoming un-proposable (or worse, proposable and unpriceable).
 *
 * `null` means the lake does not carry the field. That is a statement about the
 * lake, not about settlement: the evaluator reads the authoritative `RawMatch`
 * and can still settle any catalog field, which is what keeps parlays generated
 * before this change evaluable.
 */
export const PARLAY_HISTORY_COLUMNS: Record<
  ParticipantNumericField,
  keyof MatchLakeRow | null
> = {
  assists: "assists",
  baronKills: "baron_kills",
  champExperience: "champ_experience",
  champLevel: "champ_level",
  consumablesPurchased: null,
  damageDealtToBuildings: null,
  damageDealtToObjectives: "damage_dealt_to_objectives",
  damageDealtToTurrets: "damage_dealt_to_turrets",
  damageSelfMitigated: "damage_self_mitigated",
  deaths: "deaths",
  detectorWardsPlaced: "detector_wards_placed",
  doubleKills: "double_kills",
  dragonKills: "dragon_kills",
  goldEarned: "gold_earned",
  goldSpent: "gold_spent",
  inhibitorKills: "inhibitor_kills",
  inhibitorTakedowns: null,
  inhibitorsLost: null,
  itemsPurchased: null,
  killingSprees: "killing_sprees",
  kills: "kills",
  largestCriticalStrike: null,
  largestKillingSpree: null,
  largestMultiKill: "largest_multi_kill",
  longestTimeSpentLiving: "longest_time_spent_living",
  magicDamageDealt: null,
  magicDamageDealtToChampions: "magic_damage_dealt_to_champions",
  magicDamageTaken: null,
  neutralMinionsKilled: "neutral_minions_killed",
  nexusKills: null,
  nexusLost: null,
  nexusTakedowns: null,
  objectivesStolen: null,
  objectivesStolenAssists: null,
  pentaKills: "penta_kills",
  physicalDamageDealt: null,
  physicalDamageDealtToChampions: "physical_damage_dealt_to_champions",
  physicalDamageTaken: null,
  quadraKills: "quadra_kills",
  sightWardsBoughtInGame: null,
  spell1Casts: null,
  spell2Casts: null,
  spell3Casts: null,
  spell4Casts: null,
  summoner1Casts: null,
  summoner2Casts: null,
  timeCCingOthers: "time_ccing_others",
  timePlayed: "time_played",
  totalAllyJungleMinionsKilled: null,
  totalDamageDealt: "total_damage_dealt",
  totalDamageDealtToChampions: "total_damage_dealt_to_champions",
  totalDamageShieldedOnTeammates: null,
  totalDamageTaken: "total_damage_taken",
  totalEnemyJungleMinionsKilled: null,
  totalHeal: "total_heal",
  totalHealsOnTeammates: "total_heals_on_teammates",
  totalMinionsKilled: "total_minions_killed",
  totalTimeCCDealt: null,
  totalTimeSpentDead: "total_time_spent_dead",
  totalUnitsHealed: null,
  tripleKills: "triple_kills",
  trueDamageDealt: null,
  trueDamageDealtToChampions: "true_damage_dealt_to_champions",
  trueDamageTaken: null,
  turretKills: "turret_kills",
  turretTakedowns: null,
  turretsLost: null,
  unrealKills: null,
  visionScore: "vision_score",
  visionWardsBoughtInGame: "vision_wards_bought_in_game",
  wardsKilled: "wards_killed",
  wardsPlaced: "wards_placed",
};

/**
 * Team objective counts, reconstructed from the participant column that records
 * who landed the blow.
 *
 * The lake stores participants, not the `info.teams[].objectives` block, so a
 * team's dragon count in history is the sum of its players' `dragon_kills`.
 * That equals the authoritative objective count on real matches — pinned by a
 * test against the 5v5 fixture for all five mapped objectives — but it is still
 * a reconstruction, and only settlement reads the authoritative block.
 *
 * `riftHerald` has no participant column at all, so it cannot be reconstructed
 * and is not groundable.
 */
export const TEAM_OBJECTIVE_HISTORY_COLUMNS: Record<
  TeamObjective,
  keyof MatchLakeRow | null
> = {
  baron: "baron_kills",
  champion: "kills",
  dragon: "dragon_kills",
  inhibitor: "inhibitor_kills",
  riftHerald: null,
  tower: "turret_kills",
};

/** Catalog fields a generated parlay may propose, because history can price them. */
export function groundedParticipantFields(): ParticipantNumericField[] {
  return ParticipantNumericFieldSchema.options.filter(
    (field) => PARLAY_HISTORY_COLUMNS[field] !== null,
  );
}

/** Team objectives a generated parlay may propose. */
export function groundedTeamObjectives(): TeamObjective[] {
  return TeamObjectiveSchema.options.filter(
    (objective) => TEAM_OBJECTIVE_HISTORY_COLUMNS[objective] !== null,
  );
}

/**
 * Opponent ping columns. Every ping type is carried by the lake, so unlike the
 * participant map there is nothing here that cannot be priced — the reason a
 * ping leg is restricted at all is incentive, not data.
 */
export const OPPONENT_PING_HISTORY_COLUMNS: Record<
  OpponentPingField,
  keyof MatchLakeRow
> = {
  allInPings: "all_in_pings",
  assistMePings: "assist_me_pings",
  basicPings: "basic_pings",
  commandPings: "command_pings",
  dangerPings: "danger_pings",
  enemyMissingPings: "enemy_missing_pings",
  enemyVisionPings: "enemy_vision_pings",
  getBackPings: "get_back_pings",
  holdPings: "hold_pings",
  needVisionPings: "need_vision_pings",
  onMyWayPings: "on_my_way_pings",
  pushPings: "push_pings",
  visionClearedPings: "vision_cleared_pings",
};

/** Opponent ping fields a generated parlay may propose. */
export function groundedOpponentPingFields(): OpponentPingField[] {
  return [...OpponentPingFieldSchema.options];
}
