import {
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_GAME_SETS,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DARE_V2_MAX_TARGETS,
} from "@scout-for-lol/data";

export type RelationalScoutQlComplexityLimits = {
  ctes: number;
  joinedRelations: number;
  predicates: number;
  expressionDepth: number;
};

export const RAW_RELATIONAL_SCOUTQL_LIMITS: RelationalScoutQlComplexityLimits =
  {
    ctes: DARE_V2_MAX_GAME_SETS,
    joinedRelations: DARE_V2_MAX_JOINED_RELATIONS,
    predicates: DARE_V2_MAX_PREDICATES,
    expressionDepth: DARE_V2_MAX_EXPRESSION_DEPTH,
  };

// Canonical Dare ScoutQL uses two supporting CTEs per semantic game set plus
// one eligibility CTE. It also renders target bindings and deterministic
// eligibility joins that are not contract predicates or joined data sources.
// The reverse compiler accepts this larger physical envelope only when the
// query round-trips exactly and the reconstructed plan passes the ordinary
// semantic limits.
export const CANONICAL_DARE_SCOUTQL_LIMITS: RelationalScoutQlComplexityLimits =
  {
    ctes: DARE_V2_MAX_GAME_SETS * 2 + 1,
    joinedRelations: DARE_V2_MAX_GAME_SETS * DARE_V2_MAX_TARGETS,
    predicates:
      DARE_V2_MAX_PREDICATES +
      DARE_V2_MAX_GAME_SETS * (DARE_V2_MAX_TARGETS * 3 + 2),
    expressionDepth: DARE_V2_MAX_EXPRESSION_DEPTH + 4,
  };
