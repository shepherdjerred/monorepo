import {
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
    },
    ...(input.sqlV3 ? { sql: dareSqlV3Catalog() } : {}),
  };
}
