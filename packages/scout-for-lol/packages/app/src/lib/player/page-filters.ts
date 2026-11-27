import {
  PlayerProfileFilterSchema,
  QueueTypeSchema,
} from "@scout-for-lol/data";
import {
  parsePlayerProfileFilters,
  type PlayerProfileFilters,
} from "#src/lib/player/player-profile-filters.ts";

/**
 * The Player page's filters in its URL. Unlike the shared profile filters,
 * which start on the ranked queues, a visit here starts on every game: no
 * `queue` in the URL is "All", and Ranked is written out as its queues.
 */
export function parsePlayerPageFilters(
  searchParams: URLSearchParams,
): PlayerProfileFilters {
  const parsed = parsePlayerProfileFilters(searchParams);
  return searchParams.has("queue") ? parsed : { games: parsed.games };
}

/** The `games` and `queue` entries that say `filters`: nothing for All games. */
export function playerPageSearchParams(
  filters: PlayerProfileFilters,
): URLSearchParams {
  const parsed = PlayerProfileFilterSchema.parse(filters);
  const searchParams = new URLSearchParams();
  if (parsed.games !== "all") {
    searchParams.set("games", parsed.games.toString());
  }
  const queues = parsed.queues;
  if (queues !== undefined) {
    for (const queue of QueueTypeSchema.options) {
      if (queues.includes(queue)) searchParams.append("queue", queue);
    }
  }
  return searchParams;
}
