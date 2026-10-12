import {
  DARE_BUILDING_TYPES,
  DARE_MONSTER_TYPES,
  DARE_TEAM_POSITIONS,
  DARE_TIMELINE_EVENT_TYPES,
  DARE_MAX_ELIGIBLE_GAMES,
  DARE_MAX_HORIZON_DAYS,
  DARE_MAX_QUERY_LENGTH,
  DARE_MAX_TARGETS,
} from "@scout-for-lol/data";
import { dareSqlCatalog } from "#src/betting/dares/sql/dare-sql-catalog.ts";

/**
 * Everything `get_dare_language` tells the model about the contract vocabulary.
 *
 * Split out of `dare-tools.ts` because it is a static description of the
 * language rather than an executor: it reads no request state beyond the
 * shortlist, so keeping it here lets the tool module stay a list of
 * executors.
 */
export function dareLanguagePayload(input: {
  targets: readonly { key: string; alias: string }[];
}) {
  return {
    targets: input.targets.map((target) => ({
      key: target.key,
      alias: target.alias,
    })),
    limits: {
      targets: DARE_MAX_TARGETS,
      queryCharacters: DARE_MAX_QUERY_LENGTH,
      eligibleGames: DARE_MAX_ELIGIBLE_GAMES,
      horizonDays: DARE_MAX_HORIZON_DAYS,
    },
    defaults: {
      queues: ["solo", "flex"],
      relativeDeadlineDays: 7,
    },
    // The closed value domains the SQL compiler enforces on literals compared
    // against these columns. This tool is the only place the model can learn
    // them before it guesses — and a guessed event type counts zero, which
    // settles as a real loss rather than voiding.
    domains: {
      teamPosition: DARE_TEAM_POSITIONS,
      timelineEventType: DARE_TIMELINE_EVENT_TYPES,
      monsterType: DARE_MONSTER_TYPES,
      buildingType: DARE_BUILDING_TYPES,
    },
    listCopy: {
      displayTitle:
        "Short English list heading that a stranger could read in Discord. Same-game bundles belong in one title. No stake, deadline, SQL, or game-set slugs.",
      statusPhrases:
        "Map each game-set name to a countable English phrase the app prefixes with live '{current} of {target}'. Same-game dares have one phrase that names every constraint in that game. Cross-game dares have one phrase per game set. Not a sentence, not a second query, not slugs or gte.",
      examples: {
        simple: {
          displayTitle: "Aaron wins a game as support",
          statusPhrases: { support_win: "support wins" },
        },
        sameGame: {
          displayTitle: "Aaron wins support with 8 CS/min",
          statusPhrases: {
            qualifying_game: "game with a support win and 8 CS/min",
          },
        },
        crossGame: {
          displayTitle: "Virmel wins 3 and farms 8 CS/min",
          statusPhrases: {
            wins: "wins",
            farm: "games with 8 CS/min",
          },
        },
      },
    },
    sql: dareSqlCatalog(),
  };
}
