import { z } from "zod";
import { AvailabilitySchema } from "#shared/contract.ts";
import { ArtworkSchema } from "#shared/artwork/contract.ts";

/** The cursor of a title-ordered page. */
export const LibraryCursorSchema = z.object({
  title: z.string().max(1000),
  id: z.string().min(1).max(100),
});
/** The cursor of a page ordered by when a title was added. */
export const LibraryAddedCursorSchema = z.object({
  addedAt: z.iso.datetime(),
  id: z.string().min(1).max(100),
});
export const LibrarySortSchema = z.enum(["title", "added"]);

type LibraryCursor =
  | { sort: "title"; after: z.infer<typeof LibraryCursorSchema> | null }
  | { sort: "added"; after: z.infer<typeof LibraryAddedCursorSchema> | null };

/**
 * A cursor belongs to the sort that issued it. Null means the cursor is not
 * one that sort issues, which the query schema turns into a rejected request.
 */
function readLibraryCursor(
  sort: z.infer<typeof LibrarySortSchema>,
  cursor: string | null,
): LibraryCursor | null {
  if (cursor === null) return { sort, after: null };
  let value: unknown;
  try {
    value = JSON.parse(cursor);
  } catch {
    return null;
  }
  if (sort === "title") {
    const after = LibraryCursorSchema.safeParse(value);
    return after.success ? { sort, after: after.data } : null;
  }
  const after = LibraryAddedCursorSchema.safeParse(value);
  return after.success ? { sort, after: after.data } : null;
}

export const LibraryQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    kind: z.enum(["all", "movie", "series"]).default("all"),
    /**
     * `title` lists every title in the library, A to Z. `added` lists newest
     * first by `addedAt` and so lists only titles that have something to play.
     */
    sort: LibrarySortSchema.default("title"),
    policy: z.enum(["all", "keep", "temporary", "unclassified"]).default("all"),
    /** `following` keeps the titles the reader has a standing request for. */
    mine: z.enum(["all", "following"]).default("all"),
    /** `soon` keeps the titles that report `leavingSoon`. */
    leaving: z.enum(["all", "soon"]).default("all"),
    /**
     * A movie is available when its `availability` is `available`. A series is
     * available when `episodes` counts at least one available episode, or is
     * null because a registered external library covers it. `unavailable` is
     * every other title. A page can be shorter than `limit`, or empty, and
     * still carry `nextCursor`: availability is settled after the page is read.
     */
    availability: z.enum(["all", "available", "unavailable"]).default("all"),
    cursor: z.string().max(5000).nullable().default(null),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .superRefine((value, context) => {
    if (readLibraryCursor(value.sort, value.cursor) === null)
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Invalid library cursor for this sort",
      });
  });
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;

/** The parsed cursor of a validated query, tagged with the sort it pages. */
export function libraryCursor(
  query: Pick<LibraryQuery, "sort" | "cursor">,
): LibraryCursor {
  const cursor = readLibraryCursor(query.sort, query.cursor);
  if (cursor === null)
    throw new Error("Library query carries a cursor its schema rejects");
  return cursor;
}

/** `released` means the actor once asked for the title and no longer follows it. */
export const LibraryInterestSchema = z.enum(["following", "released", "none"]);
/**
 * A removal the household can still stop. `warning_pending`: the title is
 * scheduled to leave and its requesters are being told; no date is set yet.
 * `grace_period`: the notice was received and the files leave at `graceUntil`.
 */
export const LeavingSoonSchema = z.object({
  state: z.enum(["warning_pending", "grace_period"]),
  graceUntil: z.iso.datetime().nullable(),
});
export const LibraryPageSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.enum(["movie", "series"]),
        year: z.int().nullable(),
        artwork: ArtworkSchema,
        policy: z.enum(["keep", "temporary", "unclassified"]),
        myInterest: LibraryInterestSchema,
        /** A movie's lifecycle state. Always null for a series; read `episodes`. */
        availability: AvailabilitySchema.nullable(),
        /**
         * A series' regular-season episodes and how many are available, as the
         * catalog reports them. Null for a movie, and for a series whose count
         * is unknown because a registered external library covers it.
         */
        episodes: z
          .object({
            available: z.int().nonnegative(),
            total: z.int().nonnegative(),
          })
          .nullable(),
        /**
         * When the newest part of the title that can be played now first
         * arrived: for each movie or episode with a current file, the first
         * file Media ever recorded for it, and of those the latest. An
         * upgrade does not move it. Null when nothing can be played.
         */
        addedAt: z.iso.datetime().nullable(),
        /**
         * The soonest removal anywhere in the title, a series' episodes
         * included. Every member sees it, whoever asked for the title.
         */
        leavingSoon: LeavingSoonSchema.nullable(),
        protection: z.enum([
          "keep_indefinitely",
          "temporary_interest",
          "review_required",
        ]),
        libraryKeeping: z
          .object({
            mediaVersion: z.int().nonnegative(),
            targetVersion: z.int().nonnegative(),
            keepingPolicy: z.enum(["keep", "temporary"]),
          })
          .nullable(),
      }),
    )
    .max(50),
  nextCursor: z.string().nullable(),
});
