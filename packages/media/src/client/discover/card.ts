import type { CatalogSearch } from "#shared/api.ts";
import type {
  CatalogLibraryState,
  LibraryAccess,
} from "#shared/catalog/contract.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import {
  CATALOG_INTEREST_NOTE,
  IN_LIBRARY_COPY,
  OTHERS_FOLLOW_NOTE,
  REQUEST_COPY,
} from "#client/presentation/catalog.ts";
import type { Copy } from "#client/presentation/copy.ts";
import {
  KIND_COPY,
  kindAndYear,
  libraryStatePhrase,
} from "#client/presentation/state-phrase.ts";

export type CatalogItem = CatalogSearch["results"][number];

/** A catalog title and how far its `library` can be trusted. */
export type CatalogEntry = { item: CatalogItem; access: LibraryAccess };

type HouseholdState = {
  /** Where the title stands, or null when that is not known. */
  state: Copy | null;
  /** The phrase is an offer to ask for the title, not a state of it. */
  invites: boolean;
  /** Who in the household wants it, when anyone does. */
  note: string | null;
};

/** What the household has of a title it holds a row for. */
function heldPhrase(library: CatalogLibraryState): Copy {
  // A series reports how much of it can be played, in the library's words.
  if (library.episodes !== null) {
    return libraryStatePhrase({
      availability: null,
      episodes: library.episodes,
      leavingSoon: null,
    });
  }
  // With no count and no state, a Plex library outside Media holds the
  // episodes. That is "some of it is there", not "all of it" and not "none
  // of it".
  return library.availability === null
    ? IN_LIBRARY_COPY
    : AVAILABILITY_COPY[library.availability];
}

/**
 * What a card says about a title and the household.
 *
 * `library` is null for two different reasons, and `access` tells them
 * apart: with `current` access the household does not have the title, so the
 * card offers a request; with `stale` access nobody could check, so the card
 * says nothing at all.
 */
export function householdState(
  library: CatalogLibraryState | null,
  access: LibraryAccess,
): HouseholdState {
  if (library === null) {
    return access === "stale"
      ? { state: null, invites: false, note: null }
      : { state: REQUEST_COPY, invites: true, note: null };
  }
  return {
    state: heldPhrase(library),
    invites: false,
    note:
      CATALOG_INTEREST_NOTE[library.myInterest] ??
      (library.requested ? OTHERS_FOLLOW_NOTE : null),
  };
}

/**
 * Where a card leads: the household's own page for a title it has, and the
 * catalog's page for one it does not. The request is made on either.
 */
export function titleAddress(item: CatalogItem): string {
  return item.library === null
    ? `/catalog/${item.kind}/${String(item.externalId)}`
    : `/media/${encodeURIComponent(item.library.mediaId)}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The line under a title: its kind and year. A title that is not out yet
 * gives the day it arrives instead, which is what a list of upcoming titles
 * is read for. `today` is a `YYYY-MM-DD` day; TMDB's dates have no time or
 * zone, so they are compared and shown as written.
 */
export function releaseDetail(
  item: Pick<CatalogItem, "kind" | "date">,
  today: string,
  locale?: string,
): string {
  // TMDB leaves the date empty for a title with no release announced.
  if (!DAY.test(item.date)) return kindAndYear(item.kind, null);
  if (item.date < today) {
    return kindAndYear(item.kind, Number(item.date.slice(0, 4)));
  }
  const day = new Date(`${item.date}T00:00:00Z`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${KIND_COPY[item.kind]}, ${day}`;
}

/** Today as the reader's calendar has it, in the form TMDB writes dates. */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** One entry of a list for every title: a feed can repeat one across pages. */
export function uniqueEntries(
  entries: readonly CatalogEntry[],
): { key: string; entry: CatalogEntry }[] {
  const seen = new Set<string>();
  const unique: { key: string; entry: CatalogEntry }[] = [];
  for (const entry of entries) {
    const key = `${entry.item.kind}-${String(entry.item.externalId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ key, entry });
  }
  return unique;
}
