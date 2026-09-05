import { match } from "ts-pattern";
import {
  competitionQueuesToString,
  getChampionDisplayNameById,
  type CompetitionCriteria,
} from "@scout-for-lol/data";

/**
 * Render a competition's criteria as a short, human-readable summary
 * (e.g. "Most wins · Solo Queue") for list rows and detail headers.
 */
export function summarizeCriteria(criteria: CompetitionCriteria): string {
  return match(criteria)
    .with(
      { type: "MOST_GAMES_PLAYED" },
      (c) => `Most games · ${competitionQueuesToString(c.queues)}`,
    )
    .with(
      { type: "HIGHEST_RANK" },
      (c) =>
        `Highest rank (${c.aggregation === "MAX" ? "best" : "combined"}) · ${competitionQueuesToString(c.queues)}`,
    )
    .with(
      { type: "MOST_RANK_CLIMB" },
      (c) =>
        `Most LP gained (${c.aggregation === "MAX" ? "best" : "combined"}) · ${competitionQueuesToString(c.queues)}`,
    )
    .with(
      { type: "MOST_WINS_PLAYER" },
      (c) => `Most wins · ${competitionQueuesToString(c.queues)}`,
    )
    .with({ type: "MOST_WINS_CHAMPION" }, (c) => {
      const queue = competitionQueuesToString(c.queues);
      return `Most wins on ${getChampionDisplayNameById(c.championId)} · ${queue}`;
    })
    .with(
      { type: "HIGHEST_WIN_RATE" },
      (c) =>
        `Highest win rate (min ${c.minGames.toString()} games) · ${competitionQueuesToString(c.queues)}`,
    )
    .exhaustive();
}
