import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import { flattenConjuncts } from "#src/reports/duckdb/plan-budget.ts";
import { seq } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * match_pairs: one row per (player, other player) in the same game.
 *
 * The row's own player is an ordinary match_participants row — the same
 * scan, pushed filters, identity and server scope — and the other player is
 * a lookup joined onto it: every other participant of the game. The other
 * side is read from a second scan narrowed to the games the first kept, so a
 * query about one player reads that player's games twice rather than the
 * lake.
 *
 * Every other-side column is a lookup, so a filter on one (`other('…')`,
 * `relation = 'teammate'`) applies after the join; only filters on the
 * row's own player narrow the scans.
 */

/**
 * The games the row's own side kept. In a tracked scope only the scope's
 * players count, so a server's pairs read only its players' games.
 */
function pairKeysCte(
  subjects: SqlFragment,
  scope: LakeQueryScope,
): SqlFragment {
  return seq(
    "pair_keys AS (SELECT DISTINCT match_id FROM (",
    subjects,
    scope.kind === "global"
      ? "))"
      : ") WHERE puuid IN (SELECT puuid FROM accounts))",
  );
}

/** The other side's own scan filter: only the games pair_keys kept. */
export const PAIR_KEYS_SCAN_FILTER =
  "match_id IN (SELECT match_id FROM pair_keys)";

function pairDimensionCte(others: SqlFragment): SqlFragment {
  return seq(
    "pair_dim AS (SELECT match_id, puuid, team_id, player_subteam_id, team_position, champion_id, champion_name, concat_ws('#', riot_id_game_name, riot_id_tagline) AS riot_id FROM (",
    others,
    "))",
  );
}

const PAIR_JOIN =
  " JOIN pair_dim o ON o.match_id = m.match_id AND o.puuid <> m.puuid";

/** Positions a lane matchup is defined for; ARAM and Arena have none. */
const LANED = "('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')";

/**
 * Arena puts everyone on a team id and splits duos by subteam, so a teammate
 * shares both; in every other mode the subteam is NULL on both sides.
 */
const PAIR_ITEMS = [
  "o.riot_id AS other",
  "o.puuid AS other_puuid",
  "CASE WHEN o.team_id = m.team_id AND o.player_subteam_id IS NOT DISTINCT FROM m.player_subteam_id THEN 'teammate' ELSE 'opponent' END AS relation",
  `(o.team_id <> m.team_id AND m.team_position IN ${LANED} AND o.team_position = m.team_position) AS is_lane_opponent`,
  "o.champion_name AS other_champion",
  "o.champion_id AS other_champion_id",
  "o.team_position AS other_team_position",
].join(", ");

export type PairLookup = {
  /** CTEs that must follow the accounts CTE in a tracked scope. */
  ctes: SqlFragment[];
  join: string;
  items: string;
};

export function pairLookup(input: {
  subjects: SqlFragment;
  others: SqlFragment;
  scope: LakeQueryScope;
}): PairLookup {
  return {
    ctes: [
      pairKeysCte(input.subjects, input.scope),
      pairDimensionCte(input.others),
    ],
    join: PAIR_JOIN,
    items: PAIR_ITEMS,
  };
}

/**
 * Whether a match_pairs query names its own player. Without one, a global
 * query pairs every participant in the lake with nine others — millions of
 * rows at production size — so global scope requires one. A server's scope
 * names its players already.
 */
export function namesPairSubject(plan: ScoutQlPlan): boolean {
  return (
    plan.where !== undefined &&
    flattenConjuncts(plan.where).some(
      (conjunct) =>
        conjunct.kind === "player-ref" && conjunct.side === undefined,
    )
  );
}
