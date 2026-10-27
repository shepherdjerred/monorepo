import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { observeRequesterWatch } from "#automation/watch.ts";

const CursorSchema = z.tuple([z.uuid(), MovieEditionKeySchema]);
export const MOVIE_WATCH_CURSOR = "movie-watch:";

/** A second bounded phase keeps existing default/TV cursor and retention contracts literal. */
export async function sweepMovieWatch(
  context: MediaAutomationContext,
  rawCursor: string,
) {
  const value = rawCursor.slice(MOVIE_WATCH_CURSOR.length);
  const cursor =
    value === "start" ? null : CursorSchema.parse(value.split(":"));
  const targets = await context.db.mediaIntent.findMany({
    where: {
      edition: { not: "default" },
      availability: "available",
      media: { kind: "movie" },
      ...(cursor === null
        ? {}
        : {
            OR: [
              { mediaId: { gt: cursor[0] } },
              { mediaId: cursor[0], edition: { gt: cursor[1] } },
            ],
          }),
    },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 50,
    select: { mediaId: true, edition: true },
  });
  for (const target of targets)
    await observeRequesterWatch(context, target.mediaId, {
      edition: MovieEditionKeySchema.parse(target.edition),
    });
  const last = targets.at(-1);
  return {
    processed: targets.length,
    nextCursor:
      last !== undefined && targets.length === 50
        ? `${MOVIE_WATCH_CURSOR}${last.mediaId}:${last.edition}`
        : null,
  };
}
