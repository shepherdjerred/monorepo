import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { MediaError } from "#application/errors.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";

export const LIBRARY_MOVIE_DUE_CURSOR = "library-movie-due:";
const Cursor = z.tuple([z.uuid(), MovieEditionKeySchema]);

/** Discovery queues scoped work; the coordinator independently resolves the real management grant. */
export async function queueLibraryMovieDue(
  initial: MediaAutomationContext,
  scope: MovieEditionScope,
) {
  const context = movieManagementContext(initial);
  const invocation = context.movieManagement;
  invocation.execution.assertActive();
  const origins = await context.db.mediaHandoffReceipt.findMany({
    where: {
      selection: {
        path: ["scope", "targets"],
        array_contains: [{ mediaId: scope.mediaId, edition: scope.edition }],
      },
    },
    select: { id: true },
    take: 2,
  });
  invocation.budget.consume(origins.length);
  if (origins.length === 0) return null;
  const origin = origins[0];
  if (origin === undefined || origins.length !== 1)
    throw new MediaError(
      "library_management_unconfirmed",
      "Existing-library management has competing import approvals",
      409,
    );
  return serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, scope);
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    invocation.execution.assertActive();
    if (
      target === null ||
      !target.desiredPresence ||
      !target.monitoring ||
      target.intentionallyRemovedAt !== null ||
      target.automationEpoch !== runtime.recoveryEpoch ||
      !(await lockRuntimeAuthority(tx, runtime.recoveryEpoch))
    )
      return null;
    const bucket = Math.floor(invocation.execution.observed.wall / 21_600_000);
    const id = await queueOperation(tx, {
      key: `library-movie-due-v4:${scope.mediaId}:${scope.edition}:${String(target.generation)}:${String(bucket)}`,
      kind: "reconcile_movie_edition_v4",
      targetId: scope.mediaId,
      payload: {
        schemaVersion: 4,
        mediaId: scope.mediaId,
        scope,
        generation: target.generation,
        cursor: null,
        libraryManagementReceiptId: origin.id,
      },
    });
    invocation.execution.assertActive();
    return id;
  });
}

export async function sweepLibraryMovieDue(
  context: MediaAutomationContext,
  raw: string,
) {
  const encoded = raw.slice(LIBRARY_MOVIE_DUE_CURSOR.length);
  const cursor = encoded === "start" ? null : Cursor.parse(encoded.split(":"));
  const targets = await context.db.mediaIntent.findMany({
    where: {
      edition: { not: "default" },
      desiredPresence: true,
      monitoring: true,
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
    take: 25,
    select: { mediaId: true, edition: true },
  });
  for (const target of targets)
    await queueLibraryMovieDue(context, {
      rootMediaId: target.mediaId,
      mediaId: target.mediaId,
      edition: MovieEditionKeySchema.parse(target.edition),
    });
  const last = targets.at(-1);
  return {
    processed: targets.length,
    nextCursor:
      last !== undefined && targets.length === 25
        ? `${LIBRARY_MOVIE_DUE_CURSOR}${last.mediaId}:${last.edition}`
        : null,
  };
}
