import type { z } from "zod";
import {
  libraryCursor,
  LibraryQuerySchema,
  type LibraryPageSchema,
  type LibraryQuery,
} from "#shared/household/library.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import {
  DAY,
  HOUR,
  ago,
  pick,
  versionOf,
} from "#testing/fixture-api/support.ts";
import { storedArtwork } from "./artwork.ts";
import { leavingSoon } from "./removals.ts";
import { requestKeeping } from "./requests.ts";
import { TITLES, titleNamed, type Title } from "./titles.ts";

type LibraryPage = z.input<typeof LibraryPageSchema>;
type LibraryItem = LibraryPage["items"][number];

const POLICIES = [
  "keep",
  "temporary",
  "keep",
  "temporary",
  "unclassified",
] as const;
const INTERESTS = ["following", "none", "released", "none"] as const;
const PROTECTION = {
  keep: "keep_indefinitely",
  temporary: "temporary_interest",
  unclassified: "review_required",
} as const;

/**
 * How the library holds a title; the catalog fixtures agree with it. A title
 * one of its requests keeps for good is kept for good, as on the server.
 */
export function libraryPolicy(title: Title): (typeof POLICIES)[number] {
  return requestKeeping(title.id) === "keep"
    ? "keep"
    : pick(POLICIES, title.index);
}

/**
 * The owner's keeping switch for a title; the title page reads the same one.
 * Every fixture title has a default target, so the owner always has a switch:
 * an unclassified title is one whose Keep is off and that nobody follows.
 * The switch is the owner's own choice, so a title only a request keeps for
 * good has it off.
 */
export function libraryKeeping(
  title: Title,
  persona: Persona,
): LibraryItem["libraryKeeping"] {
  return persona === "owner"
    ? {
        mediaVersion: versionOf(title.id),
        targetVersion: (title.index % 4) + 1,
        keepingPolicy:
          pick(POLICIES, title.index) === "keep" ? "keep" : "temporary",
      }
    : null;
}

export function libraryInterest(title: Title): (typeof INTERESTS)[number] {
  return pick(INTERESTS, title.index);
}

/**
 * A series the household plays from a Plex library Media does not manage: its
 * episode count is unknown to a list, which the API reports as null.
 */
export const EXTERNALLY_HELD = titleNamed("The Wire");

/** Episodes Media holds of a series, from the state its fixture title is in. */
export function libraryEpisodes(title: Title): LibraryItem["episodes"] {
  if (title.kind === "movie" || title.id === EXTERNALLY_HELD.id) {
    return null;
  }
  const total = title.seasons.reduce((sum, count) => sum + count, 0);
  const lastSeason = title.seasons.at(-1) ?? 0;
  switch (title.availability) {
    case "available": {
      return { available: total, total };
    }
    // The latest season is still arriving.
    case "downloading":
    case "validating":
    case "importing": {
      return { available: total - lastSeason, total };
    }
    case "wanted":
    case "searching":
    case "quarantined":
    case "removed": {
      return { available: 0, total };
    }
  }
}

/** The server's `availability` filter: a series with an unknown count is available. */
function playable(title: Title): boolean {
  if (title.kind === "movie") {
    return title.availability === "available";
  }
  const episodes = libraryEpisodes(title);
  return episodes === null || episodes.available > 0;
}

/**
 * When a title's newest playable part arrived. A handful arrived this week,
 * the rest over the last two years; a title with nothing to play has no date.
 */
function addedAt(title: Title): string | null {
  if (!playable(title)) {
    return null;
  }
  const recent = title.index % 9 === 0;
  const days = recent ? title.index / 9 : 12 + ((title.index * 37) % 700);
  return ago(days * DAY + (title.index % 24) * HOUR);
}

function libraryItems(persona: Persona): (LibraryItem & { title: string })[] {
  return TITLES.map((title) => {
    const policy = libraryPolicy(title);
    return {
      id: title.id,
      title: title.title,
      kind: title.kind,
      // A few provider records carry no year.
      year: title.index % 17 === 16 ? null : title.year,
      artwork: storedArtwork(title),
      policy,
      myInterest: libraryInterest(title),
      availability: title.kind === "movie" ? title.availability : null,
      episodes: libraryEpisodes(title),
      addedAt: addedAt(title),
      leavingSoon: leavingSoon(title),
      protection: PROTECTION[policy],
      libraryKeeping: libraryKeeping(title, persona),
    };
  });
}

function matches(query: LibraryQuery, item: LibraryItem): boolean {
  const available =
    item.kind === "movie"
      ? item.availability === "available"
      : item.episodes === null || item.episodes.available > 0;
  return (
    (query.kind === "all" || item.kind === query.kind) &&
    item.title.toLowerCase().includes(query.query.toLowerCase()) &&
    (query.policy === "all" || item.policy === query.policy) &&
    (query.mine === "all" || item.myInterest === "following") &&
    (query.leaving === "all" || item.leavingSoon !== null) &&
    (query.availability === "all" ||
      available === (query.availability === "available"))
  );
}

/** The matching titles in the order the query's sort lists them. */
function ordered(query: LibraryQuery, persona: Persona): LibraryItem[] {
  const matching = libraryItems(persona).filter((item) => matches(query, item));
  if (query.sort === "title") {
    return matching.sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }
  // Newest first, and only what can be played, as the server lists it.
  return matching
    .filter((item) => item.addedAt !== null)
    .sort(
      (left, right) =>
        (right.addedAt ?? "").localeCompare(left.addedAt ?? "") ||
        right.id.localeCompare(left.id),
    );
}

function cursorOf(query: LibraryQuery, item: LibraryItem): string {
  return JSON.stringify(
    query.sort === "title"
      ? { title: item.title, id: item.id }
      : { addedAt: item.addedAt, id: item.id },
  );
}

/** A cursor-paged library, sorted and filtered the way the server does it. */
export function libraryPage(
  parameters: URLSearchParams,
  persona: Persona,
): LibraryPage {
  const query = LibraryQuerySchema.parse(Object.fromEntries(parameters));
  const cursor = libraryCursor(query);
  const matching = ordered(query, persona);
  let remaining = matching;
  if (cursor.after !== null) {
    const { id } = cursor.after;
    const position = matching.findIndex((item) => item.id === id);
    if (position === -1) {
      throw new Error(`Library cursor names an unknown title ${id}`);
    }
    remaining = matching.slice(position + 1);
  }
  const items = remaining.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last !== undefined && remaining.length > query.limit
        ? cursorOf(query, last)
        : null,
  };
}
