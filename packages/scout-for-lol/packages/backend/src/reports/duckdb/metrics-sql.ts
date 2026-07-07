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

/** Pair aggregates: stats summed across both members (p1/p2 aliases). */
export function pairAggregateSelect(): string {
  return [
    "COUNT(*)::BIGINT AS games",
    COUNT("CASE WHEN p1.win AND p2.win THEN 1 ELSE 0 END", "wins"),
    COUNT(
      "CASE WHEN p1.surrendered OR p2.surrendered THEN 1 ELSE 0 END",
      "surrenders",
    ),
    COUNT("p1.kills + p2.kills", "kills"),
    COUNT("p1.deaths + p2.deaths", "deaths"),
    COUNT("p1.assists + p2.assists", "assists"),
    COUNT("p1.creep_score + p2.creep_score", "creep_score"),
    COUNT(
      "p1.total_damage_dealt_to_champions + p2.total_damage_dealt_to_champions",
      "damage_to_champions",
    ),
    COUNT("p1.gold_earned + p2.gold_earned", "gold_earned"),
    COUNT("p1.vision_score + p2.vision_score", "vision_score"),
    COUNT("p1.total_damage_taken + p2.total_damage_taken", "damage_taken"),
    COUNT(
      "p1.total_damage_dealt + p2.total_damage_dealt",
      "total_damage_dealt",
    ),
    COUNT("p1.wards_placed + p2.wards_placed", "wards_placed"),
    COUNT(
      "p1.double_kills + p1.triple_kills + p1.quadra_kills + p1.penta_kills + " +
        "p2.double_kills + p2.triple_kills + p2.quadra_kills + p2.penta_kills",
      "multikills",
    ),
    // One duration per pair-game (p1 side only), so avg_game_duration is a
    // true per-game average; time played is summed across both members to
    // stay consistent with the pair's summed creep score.
    COUNT("p1.game_duration_seconds", "duration_seconds"),
    COUNT("p1.time_played + p2.time_played", "time_played_seconds"),
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
