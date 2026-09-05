import {
  DARE_BUILDING_TYPES,
  DARE_MONSTER_TYPES,
  DARE_TEAM_POSITIONS,
  DARE_TIMELINE_EVENT_TYPES,
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_GAME_SETS,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
} from "@scout-for-lol/data";
import { dareSqlV3Catalog } from "#src/betting/dare-sql-v3-catalog.ts";

/**
 * Everything `get_dare_language` tells the model about the contract vocabulary.
 *
 * Split out of `dare-tools.ts` because it is a static description of the
 * language rather than an executor: it reads no request state beyond the
 * shortlist and the authoring version, so keeping it here lets the tool module
 * stay a list of executors.
 */
export function dareLanguagePayload(input: {
  sqlV3: boolean;
  targets: readonly { key: string; alias: string }[];
}) {
  return {
    authoringVersion: input.sqlV3 ? 3 : 2,
    targets: input.targets.map((target) => ({
      key: target.key,
      alias: target.alias,
    })),
    limits: {
      targets: DARE_V2_MAX_TARGETS,
      gameSets: DARE_V2_MAX_GAME_SETS,
      joinedRelations: DARE_V2_MAX_JOINED_RELATIONS,
      predicates: DARE_V2_MAX_PREDICATES,
      expressionDepth: DARE_V2_MAX_EXPRESSION_DEPTH,
      queryCharacters: DARE_V2_MAX_QUERY_LENGTH,
      eligibleGames: DARE_V2_MAX_ELIGIBLE_GAMES,
      horizonDays: DARE_V2_MAX_HORIZON_DAYS,
    },
    defaults: {
      queues: ["solo", "flex"],
      relativeDeadlineDays: 7,
      orderBy: "game_end_at_asc_match_id_asc",
    },
    // The closed value domains the contract schema enforces. The contract's own
    // JSON Schema cannot carry them: `eventType` and `team_position` are checked
    // in the authoring refinement rather than in the shared value shape, so that
    // a dare already funded against a value we later drop stays readable in
    // settlement. That leaves this tool as the only place the model can learn
    // them before it guesses — and a guessed event type counts zero, which
    // settles as a real loss rather than voiding.
    domains: {
      teamPosition: DARE_TEAM_POSITIONS,
      timelineEventType: DARE_TIMELINE_EVENT_TYPES,
      // The two objective narrowings, with the rules that make them usable. A
      // mismatched pair or an unbound objective count is refused at authoring,
      // and the model can only avoid the round trip if it is told the rule here.
      monsterType: DARE_MONSTER_TYPES,
      buildingType: DARE_BUILDING_TYPES,
    },
    objectiveRules: [
      "monsterType narrows ELITE_MONSTER_KILL only; buildingType narrows BUILDING_KILL only. Riot leaves the other column empty, so a mismatched pair counts zero in every game.",
      "Never set monsterType and buildingType together: an event is either an elite monster kill or a building kill.",
      'An ELITE_MONSTER_KILL or BUILDING_KILL count must bind a target, with role "killer" or "assist". These objectives belong to the side that took them, so an unbound count includes the enemy team\'s and an enemy objective would settle the dare. A team-relative objective count cannot be expressed in a version-two contract.',
    ],
    ...(input.sqlV3 ? { sql: dareSqlV3Catalog() } : {}),
  };
}
