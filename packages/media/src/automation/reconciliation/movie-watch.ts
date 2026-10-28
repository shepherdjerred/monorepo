import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { queueMovieRetentionCheck } from "#automation/movie-editions/retention/queue.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";

const CursorSchema = z.tuple([z.uuid(), MovieEditionKeySchema]);
export const MOVIE_WATCH_CURSOR = "movie-watch:";

/** A second bounded phase keeps existing default/TV cursor and retention contracts literal. */
export async function sweepMovieWatch(
  context: MediaAutomationContext,
  rawCursor: string,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie watch sweep requires its original invocation budget",
    );
  invocation.execution.assertActive();
  const value = rawCursor.slice(MOVIE_WATCH_CURSOR.length);
  const cursor =
    value === "start" ? null : CursorSchema.parse(value.split(":"));
  const targets = await context.db.mediaIntent.findMany({
    where: {
      edition: { not: "default" },
      availability: { in: ["available", "quarantined"] },
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
    take: 2,
    select: {
      mediaId: true,
      edition: true,
      editionRootId: true,
      generation: true,
      automationEpoch: true,
    },
  });
  const target = targets[0];
  if (target !== undefined) {
    const edition = MovieEditionKeySchema.parse(target.edition);
    if (target.editionRootId !== target.mediaId)
      throw new Error("Movie watch target has unresolved canonical lineage");
    const scope = {
      rootMediaId: target.mediaId,
      mediaId: target.mediaId,
      edition,
    };
    const bucket = String(
      Math.floor(invocation.execution.observed.wall / 300_000),
    );
    try {
      await observeRequesterWatch(context, target.mediaId, { edition });
      await queueMovieRetentionCheck(context, scope, bucket);
    } catch (error) {
      if (!(error instanceof NativeArchiveScopeProtection)) throw error;
      invocation.execution.assertActive();
      const key = `movie-watch-protected:${target.mediaId}:${edition}:${String(target.generation)}:${String(target.automationEpoch)}:${bucket}`;
      await context.db.applicationEvent.upsert({
        where: { dedupeKey: key },
        update: {},
        create: {
          dedupeKey: key,
          mediaId: target.mediaId,
          kind: "movie_watch_sweep_protected",
          payload: {
            schemaVersion: 4,
            scope,
            generation: target.generation,
            recoveryEpoch: target.automationEpoch,
            reason: error.code,
          },
        },
      });
    }
  }
  return {
    processed: target === undefined ? 0 : 1,
    nextCursor:
      target !== undefined && targets.length === 2
        ? `${MOVIE_WATCH_CURSOR}${target.mediaId}:${target.edition}`
        : null,
  };
}
