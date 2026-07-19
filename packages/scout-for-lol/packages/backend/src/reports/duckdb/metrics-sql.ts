/**
 * Static aggregate SELECT lists for the ScoutQL→SQL compiler.
 *
 * Every aggregate row always carries ALL counters (mirroring the JS
 * AggregateRow), regardless of which metrics the plan requests — derived
 * metrics (win_rate, kda, losses…) are computed in JS by metricValue, and a
 * static list means no plan-driven SQL text at all in the SELECT clause.
 *
 * All outputs are explicitly cast to BIGINT/DOUBLE so DuckDB never returns
 * DECIMAL/HUGEINT wrapper objects (BigInt is handled by the row schema).
 */

const COUNT = (expr: string, alias: string): string =>
  `COALESCE(SUM(${expr}), 0)::BIGINT AS ${alias}`;
const FLAG = (column: string, alias: string): string =>
  COUNT(`CASE WHEN ${column} THEN 1 ELSE 0 END`, alias);
const MAXIMUM = (column: string, alias: string): string =>
  `COALESCE(MAX(${column}), 0)::BIGINT AS ${alias}`;

/** Single-participant aggregates (match_participants, competition_*). */
export function matchAggregateSelect(): string {
  return [
    "COUNT(*)::BIGINT AS games",
    FLAG("win", "wins"),
    FLAG("surrendered", "surrenders"),
    COUNT("kills", "kills"),
    COUNT("deaths", "deaths"),
    COUNT("assists", "assists"),
    COUNT("creep_score", "creep_score"),
    COUNT("total_damage_dealt_to_champions", "damage_to_champions"),
    COUNT("gold_earned", "gold_earned"),
    COUNT("vision_score", "vision_score"),
    COUNT("total_damage_taken", "damage_taken"),
    COUNT("total_damage_dealt", "total_damage_dealt"),
    COUNT("wards_placed", "wards_placed"),
    COUNT(
      "double_kills + triple_kills + quadra_kills + penta_kills",
      "multikills",
    ),
    COUNT("game_duration_seconds", "duration_seconds"),
    COUNT("time_played", "time_played_seconds"),
    "COUNT(*)::BIGINT AS participant_rows",
    FLAG("early_surrendered", "early_surrenders"),
    COUNT("total_minions_killed", "lane_minions"),
    COUNT("neutral_minions_killed", "neutral_minions"),
    COUNT("gold_spent", "gold_spent"),
    COUNT("damage_self_mitigated", "damage_mitigated"),
    COUNT("damage_dealt_to_objectives", "damage_to_objectives"),
    COUNT("damage_dealt_to_turrets", "damage_to_turrets"),
    COUNT("total_heal", "healing"),
    COUNT("total_heals_on_teammates", "teammate_healing"),
    COUNT("wards_killed", "wards_killed"),
    COUNT("vision_wards_bought_in_game", "control_wards_bought"),
    COUNT("detector_wards_placed", "detector_wards_placed"),
    COUNT("double_kills", "double_kills"),
    COUNT("triple_kills", "triple_kills"),
    COUNT("quadra_kills", "quadra_kills"),
    COUNT("penta_kills", "penta_kills"),
    MAXIMUM("largest_multi_kill", "largest_multikill"),
    COUNT("killing_sprees", "killing_sprees"),
    FLAG("first_blood_kill", "first_bloods"),
    COUNT("champ_level", "champion_level_total"),
    COUNT("champ_experience", "champion_experience_total"),
    COUNT("total_time_spent_dead", "time_dead_seconds"),
    MAXIMUM("longest_time_spent_living", "longest_life_seconds"),
    COUNT("time_ccing_others", "cc_time_seconds"),
    COUNT("turret_kills", "turret_kills"),
    COUNT("inhibitor_kills", "inhibitor_kills"),
    COUNT("dragon_kills", "dragon_kills"),
    COUNT("baron_kills", "baron_kills"),
    COUNT("CASE WHEN placement IS NOT NULL THEN 1 ELSE 0 END", "arena_rows"),
    COUNT("COALESCE(placement, 0)", "placement_sum"),
    COUNT("CASE WHEN placement <= 2 THEN 1 ELSE 0 END", "top_two_placements"),
    COUNT("CASE WHEN placement = 1 THEN 1 ELSE 0 END", "first_place_finishes"),
  ].join(", ");
}

/**
 * Raw per-player fact columns for teammate-group queries. Unlike the other
 * selects this is NOT aggregated: group combination generation and stat
 * summation run in JS (reports/group-combinations.ts), because the group
 * size is plan-driven and this file's static-SQL rule forbids emitting
 * per-size column text. Counter columns are cast to BIGINT so the row
 * schema's bigint handling applies uniformly.
 */
export function groupFactSelect(): string {
  return [
    "player_id",
    "player_alias",
    "match_id",
    "team_id",
    "player_subteam_id",
    "win",
    "surrendered",
    "kills::BIGINT AS kills",
    "deaths::BIGINT AS deaths",
    "assists::BIGINT AS assists",
    "creep_score::BIGINT AS creep_score",
    "total_damage_dealt_to_champions::BIGINT AS damage_to_champions",
    "gold_earned::BIGINT AS gold_earned",
    "vision_score::BIGINT AS vision_score",
    "total_damage_taken::BIGINT AS damage_taken",
    "total_damage_dealt::BIGINT AS total_damage_dealt",
    "wards_placed::BIGINT AS wards_placed",
    "(double_kills + triple_kills + quadra_kills + penta_kills)::BIGINT AS multikills",
    "game_duration_seconds::BIGINT AS game_duration_seconds",
    "time_played::BIGINT AS time_played_seconds",
    "early_surrendered",
    "total_minions_killed::BIGINT AS lane_minions",
    "neutral_minions_killed::BIGINT AS neutral_minions",
    "gold_spent::BIGINT AS gold_spent",
    "damage_self_mitigated::BIGINT AS damage_mitigated",
    "damage_dealt_to_objectives::BIGINT AS damage_to_objectives",
    "damage_dealt_to_turrets::BIGINT AS damage_to_turrets",
    "total_heal::BIGINT AS healing",
    "total_heals_on_teammates::BIGINT AS teammate_healing",
    "wards_killed::BIGINT AS wards_killed",
    "vision_wards_bought_in_game::BIGINT AS control_wards_bought",
    "detector_wards_placed::BIGINT AS detector_wards_placed",
    "double_kills::BIGINT AS double_kills",
    "triple_kills::BIGINT AS triple_kills",
    "quadra_kills::BIGINT AS quadra_kills",
    "penta_kills::BIGINT AS penta_kills",
    "largest_multi_kill::BIGINT AS largest_multikill",
    "killing_sprees::BIGINT AS killing_sprees",
    "first_blood_kill AS first_blood",
    "champ_level::BIGINT AS champion_level",
    "champ_experience::BIGINT AS champion_experience",
    "total_time_spent_dead::BIGINT AS time_dead_seconds",
    "longest_time_spent_living::BIGINT AS longest_life_seconds",
    "time_ccing_others::BIGINT AS cc_time_seconds",
    "turret_kills::BIGINT AS turret_kills",
    "inhibitor_kills::BIGINT AS inhibitor_kills",
    "dragon_kills::BIGINT AS dragon_kills",
    "baron_kills::BIGINT AS baron_kills",
    "placement::BIGINT AS placement",
  ].join(", ");
}

/**
 * Prematch observations carry no in-game stats: only games counts (every
 * stat metric reads 0).
 */
export function prematchAggregateSelect(): string {
  return [
    "COUNT(*)::BIGINT AS games",
    "0::BIGINT AS wins",
    "0::BIGINT AS surrenders",
    "0::BIGINT AS kills",
    "0::BIGINT AS deaths",
    "0::BIGINT AS assists",
    "0::BIGINT AS creep_score",
    "0::BIGINT AS damage_to_champions",
    "0::BIGINT AS gold_earned",
    "0::BIGINT AS vision_score",
    "0::BIGINT AS damage_taken",
    "0::BIGINT AS total_damage_dealt",
    "0::BIGINT AS wards_placed",
    "0::BIGINT AS multikills",
    "0::BIGINT AS duration_seconds",
    "0::BIGINT AS time_played_seconds",
    "COUNT(*)::BIGINT AS participant_rows",
    "0::BIGINT AS early_surrenders",
    "0::BIGINT AS lane_minions",
    "0::BIGINT AS neutral_minions",
    "0::BIGINT AS gold_spent",
    "0::BIGINT AS damage_mitigated",
    "0::BIGINT AS damage_to_objectives",
    "0::BIGINT AS damage_to_turrets",
    "0::BIGINT AS healing",
    "0::BIGINT AS teammate_healing",
    "0::BIGINT AS wards_killed",
    "0::BIGINT AS control_wards_bought",
    "0::BIGINT AS detector_wards_placed",
    "0::BIGINT AS double_kills",
    "0::BIGINT AS triple_kills",
    "0::BIGINT AS quadra_kills",
    "0::BIGINT AS penta_kills",
    "0::BIGINT AS largest_multikill",
    "0::BIGINT AS killing_sprees",
    "0::BIGINT AS first_bloods",
    "0::BIGINT AS champion_level_total",
    "0::BIGINT AS champion_experience_total",
    "0::BIGINT AS time_dead_seconds",
    "0::BIGINT AS longest_life_seconds",
    "0::BIGINT AS cc_time_seconds",
    "0::BIGINT AS turret_kills",
    "0::BIGINT AS inhibitor_kills",
    "0::BIGINT AS dragon_kills",
    "0::BIGINT AS baron_kills",
    "0::BIGINT AS arena_rows",
    "0::BIGINT AS placement_sum",
    "0::BIGINT AS top_two_placements",
    "0::BIGINT AS first_place_finishes",
  ].join(", ");
}
