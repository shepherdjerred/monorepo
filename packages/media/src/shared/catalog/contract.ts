import { z } from "zod";
import { AvailabilitySchema } from "#shared/contract.ts";
import { LibraryInterestSchema } from "#shared/household/library.ts";

/** Search and every feed stop at this page; `totalPages` never exceeds it. */
export const CATALOG_MAX_PAGE = 5;
export const CatalogPageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(CATALOG_MAX_PAGE)
  .default(1);

export const CatalogFeedSchema = z.enum([
  "trending",
  "popular_movies",
  "popular_series",
  "upcoming_movies",
  "on_the_air",
]);
export type CatalogFeed = z.infer<typeof CatalogFeedSchema>;

/**
 * What the household already has of a catalog title, as the actor may know it.
 * It describes the same titles `GET /library` lists and uses that view's
 * `availability` and `myInterest`, so the two never disagree about a title.
 */
export const CatalogLibraryStateSchema = z.object({
  mediaId: z.string(),
  /** A movie's lifecycle state. Always null for a series; read `episodes`. */
  availability: AvailabilitySchema.nullable(),
  /**
   * A series' regular-season episodes known to Media, aired or not, and how
   * many of them are available. Specials (season 0) are left out because a
   * request does not include them unless asked.
   *
   * Null for a movie. Null also for a series when a registered external Plex
   * library covers any of its episodes: the count is then unknown, not zero,
   * because proving which of those files are present is the title page's
   * work. Read null on a series as "some of it may be there; open the title".
   */
  episodes: z
    .object({
      available: z.int().nonnegative(),
      total: z.int().nonnegative(),
    })
    .nullable(),
  /**
   * Someone in the household, the reader or anyone else, has a standing
   * request for the title: active, not excluded, and with interest
   * `following`. It says that the title is wanted, never by whom. It is only
   * ever reported on a title the reader may see; otherwise `library` is null.
   */
  requested: z.boolean(),
  myInterest: LibraryInterestSchema,
});
export type CatalogLibraryState = z.infer<typeof CatalogLibraryStateSchema>;

/**
 * `stale` means the actor's Plex library access was not verified recently
 * enough to say which titles they may see, so every `library` is null without
 * meaning "not in the library". The same condition makes `GET /library`
 * answer 403 `plex_library_access_required`.
 */
export const LibraryAccessSchema = z.enum(["current", "stale"]);
export type LibraryAccess = z.infer<typeof LibraryAccessSchema>;

/**
 * A runtime in whole minutes, or null when it is not known. A film has one and
 * so does an episode; a series and a season have none of their own.
 */
export const RuntimeMinutesSchema = z.int().positive().nullable();
/**
 * TMDB reports a runtime it does not know as 0, and Media stores what TMDB
 * sent. A read reports that as unknown, never as a film of no length.
 */
export function knownRuntimeMinutes(minutes: number | null): number | null {
  return minutes !== null && minutes > 0 ? minutes : null;
}
