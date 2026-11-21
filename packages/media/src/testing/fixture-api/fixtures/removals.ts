import type { z } from "zod";
import type { RemovalListSchema } from "#shared/api.ts";
import {
  RemovalHistoryCursorSchema,
  type RemovalHistoryItemSchema,
  type RemovalHistoryPageSchema,
} from "#shared/household/calendar.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import {
  DAY,
  ago,
  ahead,
  fixtureId,
  versionOf,
} from "#testing/fixture-api/support.ts";
import { storedArtwork } from "./artwork.ts";
import {
  episodeId,
  episodeItem,
  seasonId,
  titleNamed,
  type Title,
} from "./titles.ts";

type RemovalList = z.input<typeof RemovalListSchema>;
type HistoryItem = z.input<typeof RemovalHistoryItemSchema>;
type HistoryPage = z.input<typeof RemovalHistoryPageSchema>;

type RemovalSeed = readonly [
  title: string,
  /** One of the three states `GET /api/v1/removals` lists. */
  state: "warning_pending" | "grace_period" | "quarantined",
  /** Days until the grace period ends; negative once it has passed. */
  graceDays: number | null,
  purgeDays: number | null,
  /** Whether the signed-in member is one of those who asked for the title. */
  asked: "viewer" | "another member",
  /**
   * The season whose first episodes are leaving, one removal each, when it
   * is not the whole title that leaves.
   */
  season?: number,
];

/** How many episodes of a seeded season leave, a day apart. */
const LEAVING_EPISODES = 4;

/**
 * Titles leaving soon, one or more per state, and one series that is losing
 * several episodes at once.
 */
const REMOVALS: readonly RemovalSeed[] = [
  ["The Expanse", "grace_period", 3, null, "viewer", 6],
  ["Mr. Robot", "grace_period", 6, null, "another member"],
  ["Knives Out", "warning_pending", null, null, "another member"],
  ["Top Gun: Maverick", "warning_pending", null, null, "viewer"],
  ["The Holdovers", "quarantined", -2, 5, "another member"],
  ["Silo", "quarantined", -5, 2, "viewer"],
  ["Get Out", "grace_period", 1, null, "viewer"],
  ["Cowboy Bebop", "grace_period", 7, null, "another member"],
];

/**
 * The id of the retention decision behind one removal. The removal list and
 * the removal history both report a decision under this id, which is how a
 * client knows a history row and a listed removal are the same thing.
 */
function decisionId(seedIndex: number, part: number): string {
  return fixtureId(12, (seedIndex + 1) * 100 + part);
}

/** What one seed removes: the title itself, or episodes of one season. */
function removedItems(
  title: Title,
  season: number | undefined,
): { id: string; title: string; kind: string; days: number }[] {
  if (season === undefined) {
    return [{ id: title.id, title: title.title, kind: title.kind, days: 0 }];
  }
  return Array.from({ length: LEAVING_EPISODES }, (_, index) => {
    const episode = episodeItem(title, season, index + 1);
    return {
      id: episodeId(title, season, index + 1),
      title: episode.title,
      kind: episode.kind,
      days: index,
    };
  });
}

/**
 * A removal the household can still stop, as the library reports it on the
 * title: only these two states count as leaving soon.
 */
export function leavingSoon(title: Title): {
  state: "warning_pending" | "grace_period";
  graceUntil: string | null;
} | null {
  for (const [name, state, graceDays] of REMOVALS) {
    if (
      name === title.title &&
      (state === "warning_pending" || state === "grace_period")
    ) {
      return {
        state,
        graceUntil: graceDays === null ? null : ahead(graceDays * DAY),
      };
    }
  }
  return null;
}

/** The newest removal decision of a title, in whatever state it is in. */
export function removalOf(title: Title): {
  state: string;
  graceUntil: string | null;
  purgeAfter: string | null;
} | null {
  const seed = REMOVALS.find(([name]) => name === title.title);
  if (seed === undefined) {
    return null;
  }
  const [, state, graceDays, purgeDays] = seed;
  return {
    state,
    graceUntil: graceDays === null ? null : ahead(graceDays * DAY),
    purgeAfter: purgeDays === null ? null : ahead(purgeDays * DAY),
  };
}

/**
 * The owner sees every removal. A member sees every title that has not left
 * yet, whoever asked for it, and a quarantined one only when they asked for
 * it: restoring it is theirs or the owner's to do.
 */
export function removalList(persona: Persona): RemovalList {
  return REMOVALS.flatMap(
    ([name, state, graceDays, purgeDays, asked, season], index) => {
      if (
        persona !== "owner" &&
        state === "quarantined" &&
        asked !== "viewer"
      ) {
        return [];
      }
      const title = titleNamed(name);
      return removedItems(title, season).map((item, part) => ({
        id: decisionId(index, part),
        mediaId: item.id,
        rootMediaId: title.id,
        rootTitle: title.title,
        artwork: storedArtwork(title),
        state,
        graceUntil:
          graceDays === null ? null : ahead((graceDays + item.days) * DAY),
        purgeAfter: purgeDays === null ? null : ahead(purgeDays * DAY),
        media: {
          title: item.title,
          kind: item.kind,
          version: versionOf(item.id),
        },
      }));
    },
  );
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

/**
 * Removed titles, newest first, covering every state and restore outcome.
 * `context` says whose request each was: the signed-in member's, or only
 * other people's.
 *
 * The five newest are all other people's, which is a whole page: a member's
 * first page of history is therefore empty and still has more behind it.
 * One film has two versions set aside at once: its default version, which
 * the removal list also holds, and a named cut, which it never does.
 */
const HISTORY: readonly HistorySeed[] = [
  {
    title: "Parasite",
    kind: "movie",
    reason: "owner_removed",
    context: "household",
    state: "restored",
    restore: "restored",
    quarantinedDaysAgo: 1,
  },
  {
    title: "Chernobyl",
    kind: "series",
    reason: "watched_by_requesters",
    context: "household",
    state: "cancelled",
    restore: "unavailable",
    quarantinedDaysAgo: 1,
  },
  {
    title: "Interstellar",
    kind: "movie",
    reason: "temporary_interest_released",
    context: "household",
    state: "restored",
    restore: "restored",
    quarantinedDaysAgo: 2,
  },
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
    title: "The Holdovers",
    kind: "movie",
    reason: "owner_removed",
    context: "household",
    state: "quarantined",
    restore: "recoverable",
    quarantinedDaysAgo: 2,
    edition: "directors_cut",
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

/**
 * A set-aside default version of a whole title is a decision the removal
 * list holds too, so its history row carries that decision's id. Every other
 * history row is a decision the list does not hold.
 */
function historyId(seed: HistorySeed, index: number): string {
  const listed = REMOVALS.findIndex(
    (removal) =>
      removal[0] === seed.title &&
      removal[1] === "quarantined" &&
      removal[5] === undefined,
  );
  return listed !== -1 &&
    seed.state === "quarantined" &&
    seed.edition === undefined &&
    (seed.kind === "movie" || seed.kind === "series")
    ? decisionId(listed, 0)
    : fixtureId(13, index + 1);
}

/** Every removal decision, with whose request it was. */
const HISTORY_ITEMS: readonly HistoryItem[] = HISTORY.map((seed, index) => ({
  id: historyId(seed, index),
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

const HISTORY_PAGE_SIZE = 5;

/**
 * What a page of decisions shows its reader, as the server decides it after
 * the page has been cut. The owner sees every decision, as the household's.
 * A member sees only the ones that were their own request, so a page can
 * come back short, or empty, and still have more behind it.
 */
function shownTo(persona: Persona, page: readonly HistoryItem[]) {
  return persona === "owner"
    ? page.map((item) => ({ ...item, requesterContext: "household" as const }))
    : page.filter((item) => item.requesterContext === "your_request");
}

export function removalHistory(
  parameters: URLSearchParams,
  persona: Persona,
): HistoryPage {
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
  const page = HISTORY_ITEMS.slice(start, start + HISTORY_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: shownTo(persona, page),
    nextCursor:
      last !== undefined && start + HISTORY_PAGE_SIZE < HISTORY_ITEMS.length
        ? JSON.stringify({ createdAt: last.quarantinedAt, id: last.id })
        : null,
  };
}
