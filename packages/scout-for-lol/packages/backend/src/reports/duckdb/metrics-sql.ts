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
  ].join(", ");
}

/**
 * Prematch observations carry no in-game stats: only games counts (parity
 * with the fact engine, where aggregatePrematchFacts increments games only
 * and every stat metric reads 0).
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
  ].join(", ");
}
