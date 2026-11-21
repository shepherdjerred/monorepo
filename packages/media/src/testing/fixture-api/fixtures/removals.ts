import type { z } from "zod";
import type { RemovalListSchema } from "#shared/api.ts";
import {
  RemovalHistoryCursorSchema,
  type RemovalHistoryItemSchema,
  type RemovalHistoryPageSchema,
} from "#shared/household/calendar.ts";
import {
  DAY,
  ago,
  ahead,
  fixtureId,
  versionOf,
} from "#testing/fixture-api/support.ts";
import { storedArtwork } from "./artwork.ts";
import { episodeId, seasonId, titleNamed, type Title } from "./titles.ts";

type RemovalList = z.input<typeof RemovalListSchema>;
type HistoryItem = z.input<typeof RemovalHistoryItemSchema>;
type HistoryPage = z.input<typeof RemovalHistoryPageSchema>;

type RemovalSeed = readonly [
  title: string,
  state: string,
  /** Days until the grace period ends; negative once it has passed. */
  graceDays: number | null,
  purgeDays: number | null,
];

/** Titles leaving soon, one or more per retention state. */
const REMOVALS: readonly RemovalSeed[] = [
  ["The Expanse", "grace_period", 3, null],
  ["Mr. Robot", "grace_period", 6, null],
  ["Knives Out", "warning_pending", null, null],
  ["Top Gun: Maverick", "notice_pending", null, null],
  ["The Holdovers", "quarantined", -2, 5],
  ["Silo", "quarantined", -5, 2],
  ["Get Out", "grace_period", 1, null],
  ["Cowboy Bebop", "reply_pending", 7, null],
];

export function removalList(): RemovalList {
  return REMOVALS.map(([name, state, graceDays, purgeDays], index) => {
    const title = titleNamed(name);
    return {
      id: fixtureId(12, index + 1),
      mediaId: title.id,
      rootMediaId: title.id,
      artwork: storedArtwork(title),
      state,
      graceUntil: graceDays === null ? null : ahead(graceDays * DAY),
      purgeAfter: purgeDays === null ? null : ahead(purgeDays * DAY),
      media: {
        title: title.title,
        kind: title.kind,
        version: versionOf(title.id),
      },
    };
  });
}

type HistorySeed = {
  title: string;
  kind: HistoryItem["kind"];
  reason: HistoryItem["reason"];
  context: HistoryItem["requesterContext"];
  state: HistoryItem["state"];
  restore: HistoryItem["restoreState"];
  quarantinedDaysAgo: number;
  purgedDaysAgo?: number;
  edition?: string;
};

/** Removed titles, newest first, covering every state and restore outcome. */
const HISTORY: readonly HistorySeed[] = [
  {
    title: "The Holdovers",
    kind: "movie",
    reason: "owner_removed",
    context: "household",
    state: "quarantined",
    restore: "recoverable",
    quarantinedDaysAgo: 2,
  },
  {
    title: "Hacks",
    kind: "season",
    reason: "watched_by_requesters",
    context: "your_request",
    state: "quarantined",
    restore: "recoverable",
    quarantinedDaysAgo: 3,
  },
  {
    title: "Silo",
    kind: "series",
    reason: "temporary_interest_released",
    context: "your_request",
    state: "quarantined",
    restore: "recoverable",
    quarantinedDaysAgo: 5,
  },
  {
    title: "Moonlight",
    kind: "movie",
    reason: "watched_by_requesters",
    context: "your_request",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 27,
    purgedDaysAgo: 20,
  },
  {
    title: "Twin Peaks",
    kind: "series",
    reason: "temporary_interest_released",
    context: "your_request",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 28,
    purgedDaysAgo: 21,
  },
  {
    title: "Whiplash",
    kind: "movie",
    reason: "owner_removed",
    context: "household",
    state: "restored",
    restore: "restored",
    quarantinedDaysAgo: 33,
  },
  {
    title: "Ted Lasso",
    kind: "episode",
    reason: "owner_removed",
    context: "household",
    state: "cancelled",
    restore: "unavailable",
    quarantinedDaysAgo: 40,
  },
  {
    title: "Heat",
    kind: "movie",
    reason: "temporary_interest_released",
    context: "household",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 51,
    purgedDaysAgo: 44,
  },
  {
    title: "Dark",
    kind: "series",
    reason: "owner_removed",
    context: "your_request",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 60,
    purgedDaysAgo: 53,
  },
  {
    title: "Blade Runner",
    kind: "movie",
    reason: "owner_removed",
    context: "household",
    state: "restored",
    restore: "restored",
    quarantinedDaysAgo: 75,
    edition: "final_cut",
  },
  {
    title: "Arcane",
    kind: "season",
    reason: "watched_by_requesters",
    context: "household",
    state: "purged",
    restore: "unavailable",
    quarantinedDaysAgo: 90,
    purgedDaysAgo: 83,
  },
  {
    title: "The Wire",
    kind: "season",
    reason: "temporary_interest_released",
    context: "household",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 120,
    purgedDaysAgo: 113,
  },
  {
    title: "Get Out",
    kind: "movie",
    reason: "watched_by_requesters",
    context: "your_request",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 150,
    purgedDaysAgo: 143,
  },
  {
    title: "Fleabag",
    kind: "series",
    reason: "owner_removed",
    context: "household",
    state: "purged",
    restore: "reacquire",
    quarantinedDaysAgo: 200,
    purgedDaysAgo: 193,
  },
];

const RESTORE_WINDOW_DAYS = 7;
const HISTORY_SEASON = 2;
const HISTORY_EPISODE = 4;

type Subject = Pick<
  HistoryItem,
  | "mediaId"
  | "rootMediaId"
  | "artwork"
  | "title"
  | "seriesTitle"
  | "seasonNumber"
  | "episodeNumber"
>;

/** A removed season or episode keeps its series as its root and for its art. */
function subject(title: Title, kind: HistoryItem["kind"]): Subject {
  return {
    ...removed(title, kind),
    rootMediaId: title.id,
    artwork: storedArtwork(title),
  };
}

function removed(
  title: Title,
  kind: HistoryItem["kind"],
): Omit<Subject, "rootMediaId" | "artwork"> {
  switch (kind) {
    case "movie":
    case "series":
      return {
        mediaId: title.id,
        title: title.title,
        seriesTitle: null,
        seasonNumber: null,
        episodeNumber: null,
      };
    case "season":
      return {
        mediaId: seasonId(title, HISTORY_SEASON),
        title: `Season ${String(HISTORY_SEASON)}`,
        seriesTitle: title.title,
        seasonNumber: HISTORY_SEASON,
        episodeNumber: null,
      };
    case "episode":
      return {
        mediaId: episodeId(title, HISTORY_SEASON, HISTORY_EPISODE),
        title: "Headspace",
        seriesTitle: title.title,
        seasonNumber: HISTORY_SEASON,
        episodeNumber: HISTORY_EPISODE,
      };
  }
}

/** A cancelled removal never opened a restore window. */
function restoreDeadline(seed: HistorySeed): string | null {
  if (seed.state === "cancelled") {
    return null;
  }
  const remaining = RESTORE_WINDOW_DAYS - seed.quarantinedDaysAgo;
  return remaining >= 0 ? ahead(remaining * DAY) : ago(-remaining * DAY);
}

const HISTORY_ITEMS: readonly HistoryItem[] = HISTORY.map((seed, index) => ({
  id: fixtureId(13, index + 1),
  ...subject(titleNamed(seed.title), seed.kind),
  kind: seed.kind,
  edition: seed.edition ?? "default",
  reason: seed.reason,
  actor: seed.reason === "owner_removed" ? "owner" : "automatic",
  requesterContext: seed.context,
  state: seed.state,
  quarantinedAt: ago(seed.quarantinedDaysAgo * DAY),
  purgedAt:
    seed.purgedDaysAgo === undefined ? null : ago(seed.purgedDaysAgo * DAY),
  restoreDeadline: restoreDeadline(seed),
  restoreState: seed.restore,
}));

const HISTORY_PAGE_SIZE = 10;

export function removalHistory(parameters: URLSearchParams): HistoryPage {
  const cursor = parameters.get("cursor");
  let start = 0;
  if (cursor !== null) {
    const after = RemovalHistoryCursorSchema.parse(JSON.parse(cursor));
    const position = HISTORY_ITEMS.findIndex((item) => item.id === after.id);
    if (position === -1) {
      throw new Error(`Removal cursor names an unknown removal ${after.id}`);
    }
    start = position + 1;
  }
  const items = HISTORY_ITEMS.slice(start, start + HISTORY_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last !== undefined && start + HISTORY_PAGE_SIZE < HISTORY_ITEMS.length
        ? JSON.stringify({ createdAt: last.quarantinedAt, id: last.id })
        : null,
  };
}
