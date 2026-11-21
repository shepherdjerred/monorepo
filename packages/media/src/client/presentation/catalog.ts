import type { z } from "zod";
import type { CatalogFeed } from "#shared/catalog/contract.ts";
import type { LibraryInterestSchema } from "#shared/household/library.ts";
import type { Copy } from "./copy.ts";

/** A browse feed: the heading of its row, and what the list is. */
export const FEED_COPY = {
  trending: {
    title: "Trending this week",
    about: "The films and series most people are looking up this week.",
  },
  popular_movies: {
    title: "Popular films",
    about: "The films most people are watching right now.",
  },
  popular_series: {
    title: "Popular series",
    about: "The series most people are watching right now.",
  },
  upcoming_movies: {
    title: "Upcoming films",
    about: "Films that reach cinemas in the next few weeks.",
  },
  on_the_air: {
    title: "Airing this week",
    about: "Series with a new episode in the next seven days.",
  },
} as const satisfies Record<CatalogFeed, { title: string; about: string }>;

/**
 * The reader's own tie to a catalog title, as the line under its card.
 * Having let a title go says nothing here: the card is an offer to ask
 * again, not a record of what they did.
 */
export const CATALOG_INTEREST_NOTE = {
  following: "You follow this",
  released: null,
  none: null,
} as const satisfies Record<
  z.infer<typeof LibraryInterestSchema>,
  string | null
>;

/** Someone else in the household has a standing request for the title. */
export const OTHERS_FOLLOW_NOTE = "Others follow this";

/**
 * A title the household does not have. The card is a link to the title's
 * page, where the request is made, so this names what the reader can do
 * there.
 */
export const REQUEST_COPY: Copy = { label: "Request", tone: "neutral" };

/**
 * A title the household has, with no finer state to report: a series whose
 * episodes a Plex library outside Media holds, so how much of it is there is
 * for the title page to say.
 */
export const IN_LIBRARY_COPY: Copy = { label: "In the library", tone: "ok" };
