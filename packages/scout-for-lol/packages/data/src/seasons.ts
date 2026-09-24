import { z } from "zod";
import { isWithinInterval, isAfter } from "date-fns";

/**
 * League of Legends Season Data
 *
 * Season start/end dates are manually maintained since there's no reliable API.
 * Dates are in UTC and represent the start of the first day and end of the last day.
 *
 * APPEND-ONLY: Once a season is referenced by a Competition row, it must
 * remain in this map. The `Season` table in the backend is seeded from this
 * constant on every bot startup, and `Competition.seasonId` is a FK to
 * `Season.id` — removing an entry breaks referential integrity for any
 * existing competition tied to that season.
 *
 * To retire an old season from the UI, prefer adjusting `getSeasonChoices`
 * (which already filters by `endDate >= now`) rather than deleting it here.
 * When Riot shifts a season's end date, edit the entry in place — the
 * startup seeder will propagate the new value to the `Season` table on the
 * next boot, and every season-based Competition picks it up via the FK join.
 */

/**
 * Valid season IDs as a Zod enum
 */
export const SeasonIdSchema = z.enum([
  "2025_SEASON_3_ACT_1",
  "2025_SEASON_3_ACT_2",
  "2026_SEASON_1_ACT_1",
  "2026_SEASON_1_ACT_2",
  "2026_SEASON_2_ACT_1",
  "2026_SEASON_2_ACT_2",
  "2026_SEASON_3_ACT_1",
]);

export type SeasonId = z.infer<typeof SeasonIdSchema>;

/**
 * Season data type
 */
export type SeasonData = {
  id: SeasonId;
  displayName: string;
  startDate: Date;
  endDate: Date;
};

export const SEASONS: Record<SeasonId, SeasonData> = {
  "2025_SEASON_3_ACT_1": {
    id: "2025_SEASON_3_ACT_1",
    displayName: "Trials of Twilight",
    startDate: new Date("2025-08-27T00:00:00-07:00"),
    endDate: new Date("2025-10-21T23:59:59-07:00"),
  },
  "2025_SEASON_3_ACT_2": {
    id: "2025_SEASON_3_ACT_2",
    displayName: "Worlds 2025",
    startDate: new Date("2025-10-22T00:00:00-07:00"),
    endDate: new Date("2026-01-07T23:59:59-08:00"),
  },
  "2026_SEASON_1_ACT_1": {
    id: "2026_SEASON_1_ACT_1",
    displayName: "For Demacia (Act 1)",
    startDate: new Date("2026-01-08T00:00:00-08:00"),
    endDate: new Date("2026-03-03T23:59:59-08:00"),
  },
  "2026_SEASON_1_ACT_2": {
    id: "2026_SEASON_1_ACT_2",
    displayName: "For Demacia (Act 2)",
    startDate: new Date("2026-03-04T00:00:00-08:00"),
    endDate: new Date("2026-04-28T23:59:59-07:00"),
  },
  "2026_SEASON_2_ACT_1": {
    id: "2026_SEASON_2_ACT_1",
    displayName: "Pandemonium (Act 1)",
    startDate: new Date("2026-04-29T00:00:00-07:00"),
    endDate: new Date("2026-06-09T23:59:59-07:00"),
  },
  "2026_SEASON_2_ACT_2": {
    id: "2026_SEASON_2_ACT_2",
    displayName: "Pandemonium (Act 2)",
    startDate: new Date("2026-06-10T00:00:00-07:00"),
    endDate: new Date("2026-07-28T23:59:59-07:00"),
  },
  "2026_SEASON_3_ACT_1": {
    id: "2026_SEASON_3_ACT_1",
    displayName: "Classic (Act 1)",
    startDate: new Date("2026-07-29T12:00:00-07:00"),
    endDate: new Date("2026-10-20T23:59:59-07:00"),
  },
};

/**
 * Get season data by ID
 * @param seasonId The season ID
 * @returns Season data or undefined if not found
 */
export function getSeasonById(seasonId: string): SeasonData | undefined {
  const result = SeasonIdSchema.safeParse(seasonId);
  return result.success ? SEASONS[result.data] : undefined;
}

/**
 * Get all seasons sorted by start date (newest first)
 * @returns Array of all season data
 */
export function getAllSeasons(): SeasonData[] {
  return Object.values(SEASONS).toSorted(
    (a, b) => b.startDate.getTime() - a.startDate.getTime(),
  );
}

/**
 * Get current active season (based on current date)
 * @returns Current season data or undefined if no active season
 */
export function getCurrentSeason(): SeasonData | undefined {
  const now = new Date();
  return getAllSeasons().find((season) =>
    isWithinInterval(now, { start: season.startDate, end: season.endDate }),
  );
}

/**
 * Get season choices for Discord autocomplete
 * Only returns seasons that haven't ended yet (current and future seasons)
 * @param now Date used to determine whether each season has ended
 * @returns Array of {name, value} for Discord choices
 */
export function getSeasonChoices(
  now: Date = new Date(),
): { name: string; value: SeasonId }[] {
  return getAllSeasons()
    .filter((season) => season.endDate >= now)
    .map((season) => ({
      name: season.displayName,
      value: season.id,
    }));
}

/**
 * Get season start and end dates
 * @param seasonId The season ID
 * @returns Object with startDate and endDate or undefined if not found
 */
export function getSeasonDates(
  seasonId: string,
): { startDate: Date; endDate: Date } | undefined {
  const season = getSeasonById(seasonId);
  if (!season) {
    return undefined;
  }
  return {
    startDate: season.startDate,
    endDate: season.endDate,
  };
}

/**
 * Check if a season has ended
 * @param seasonId The season ID
 * @param now Optional date to check against (defaults to current date)
 * @returns true if season has ended, false if not, undefined if season not found
 */
export function hasSeasonEnded(
  seasonId: string,
  now: Date = new Date(),
): boolean | undefined {
  const season = getSeasonById(seasonId);
  return season ? isAfter(now, season.endDate) : undefined;
}

/**
 * Ranked split ids are the act prefix `YYYY_SEASON_N`. Rank is continuous
 * across acts in a split, so LP graphs and previous-season summaries group
 * by this id rather than by competition act.
 */
export const RankedSplitIdSchema = z
  .string()
  .regex(/^\d{4}_SEASON_\d+$/u, "Ranked split id must be YYYY_SEASON_N");
export type RankedSplitId = z.infer<typeof RankedSplitIdSchema>;

export const EARLIER_RANKED_SPLIT_ID = "earlier";

export type RankedSplit = {
  id: RankedSplitId;
  displayName: string;
  startDate: Date;
  endDate: Date;
};

export type EarlierRankedSplit = {
  id: typeof EARLIER_RANKED_SPLIT_ID;
  displayName: "Earlier";
};

export type RankedSplitRef = RankedSplit | EarlierRankedSplit;

const SEASON_ACT_ID = /^(\d{4}_SEASON_\d+)_ACT_\d+$/u;
const SPLIT_ID_PARTS = /^(\d{4})_SEASON_(\d+)$/u;

export function rankedSplitIdFromSeasonId(seasonId: SeasonId): RankedSplitId {
  const grouped = SEASON_ACT_ID.exec(seasonId);
  const splitId = grouped?.[1];
  if (splitId === undefined) {
    throw new Error(`Season id ${seasonId} is not a ranked act`);
  }
  return RankedSplitIdSchema.parse(splitId);
}

export function rankedSplitDisplayName(splitId: RankedSplitId): string {
  const parts = SPLIT_ID_PARTS.exec(splitId);
  const year = parts?.[1];
  const season = parts?.[2];
  if (year === undefined || season === undefined) {
    throw new Error(`Ranked split id ${splitId} is not YYYY_SEASON_N`);
  }
  return `${year} Season ${season}`;
}

/**
 * Ranked splits newest-first, one row per `YYYY_SEASON_N` covering every
 * bundled act in that split.
 */
export function getRankedSplits(): RankedSplit[] {
  const actsBySplit = new Map<RankedSplitId, SeasonData[]>();
  for (const season of getAllSeasons()) {
    const splitId = rankedSplitIdFromSeasonId(season.id);
    const acts = actsBySplit.get(splitId);
    if (acts === undefined) {
      actsBySplit.set(splitId, [season]);
    } else {
      acts.push(season);
    }
  }
  const splits: RankedSplit[] = [];
  for (const [id, acts] of actsBySplit) {
    const startTimes = acts.map((act) => act.startDate.getTime());
    const endTimes = acts.map((act) => act.endDate.getTime());
    const start = startTimes[0];
    const end = endTimes[0];
    if (start === undefined || end === undefined) {
      throw new Error(`Ranked split ${id} has no acts`);
    }
    splits.push({
      id,
      displayName: rankedSplitDisplayName(id),
      startDate: new Date(Math.min(...startTimes)),
      endDate: new Date(Math.max(...endTimes)),
    });
  }
  return splits.toSorted(
    (left, right) => right.startDate.getTime() - left.startDate.getTime(),
  );
}

/**
 * Split whose start is the latest start at or before `now`. After the last
 * bundled act ends, that split stays current until a newer split starts.
 * Before every bundled split, fall back to the newest configured split so
 * callers always have a graph window.
 */
export function getCurrentRankedSplit(now: Date = new Date()): RankedSplit {
  const splits = getRankedSplits();
  const started = splits.find(
    (split) => split.startDate.getTime() <= now.getTime(),
  );
  const current = started ?? splits[0];
  if (current === undefined) {
    throw new Error("Scout has no ranked splits configured");
  }
  return current;
}

/**
 * Assign an observation to a split by the latest split that has started at
 * `at`. Timestamps before the first bundled act are `earlier`.
 */
export function rankedSplitForTimestamp(at: Date): RankedSplitRef {
  const splits = getRankedSplits();
  const started = splits.find(
    (split) => split.startDate.getTime() <= at.getTime(),
  );
  return started ?? { id: EARLIER_RANKED_SPLIT_ID, displayName: "Earlier" };
}
