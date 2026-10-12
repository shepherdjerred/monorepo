import {
  DARE_MAX_EXPRESSION_DEPTH,
  DARE_MAX_GAME_SETS,
  DARE_MAX_JOINED_RELATIONS,
  DARE_MAX_PREDICATES,
} from "@scout-for-lol/data";

export type RelationalScoutQlComplexityLimits = {
  ctes: number;
  joinedRelations: number;
  predicates: number;
  expressionDepth: number;
};

export const RAW_RELATIONAL_SCOUTQL_LIMITS: RelationalScoutQlComplexityLimits =
  {
    ctes: DARE_MAX_GAME_SETS,
    joinedRelations: DARE_MAX_JOINED_RELATIONS,
    predicates: DARE_MAX_PREDICATES,
    expressionDepth: DARE_MAX_EXPRESSION_DEPTH,
  };
