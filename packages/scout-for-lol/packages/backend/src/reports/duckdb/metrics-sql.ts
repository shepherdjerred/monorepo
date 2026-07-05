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
  ].join(", ");
}
