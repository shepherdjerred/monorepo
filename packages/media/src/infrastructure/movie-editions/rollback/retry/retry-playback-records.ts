import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { MovieRollbackPlaybackReferenceV1Schema } from "#shared/movie-editions/rollback/playback-reference.ts";
import { MovieRollbackRetryPlaybackV1Schema } from "#shared/movie-editions/rollback/retry-playback.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MovieRollbackRetryParentV1 } from "./retry-context.ts";
import type { readMovieRollbackHandoffV1 } from "./handoff-records.ts";
import { assertMovieRollbackCanonical } from "#infrastructure/movie-editions/rollback/canonical.ts";
import { movieRollbackRetryPlaybackPathsV1 } from "./retry-paths.ts";

export async function readMovieRollbackRetryPlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    parent: MovieRollbackRetryParentV1;
    handoff: NonNullable<
      Awaited<ReturnType<typeof readMovieRollbackHandoffV1>>
    >;
    invocation: MovieManagementInvocation;
  },
) {
  const { parent, handoff, invocation } = input;
  const pointer = z
    .object({
      movieRollbackRetryPlaybackV1:
        MovieRollbackPlaybackReferenceV1Schema.optional(),
    })
    .nullable()
    .parse(parent.operation.result)?.movieRollbackRetryPlaybackV1;
  if (pointer === undefined)
    throw new FileGuardError("movie_rollback_playback_observation_required");
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: pointer.eventId },
  });
  invocation.budget.consume(1);
  const envelope = z
    .strictObject({ guard: z.json(), guardHash: z.string(), raw: z.string() })
    .parse(event.payload);
  const guard = parsePlexRecord(
    MovieRollbackRetryPlaybackV1Schema,
    envelope.guard,
    envelope.guardHash,
  );
  assertMovieRollbackCanonical(envelope.raw, guard, envelope.guardHash);
  assertMovieRollbackCanonical(
    guard.commandRaw,
    handoff.command.operation.payload,
    guard.commandHash,
  );
  assertMovieRollbackCanonical(guard.pathsRaw, guard.paths, guard.pathsHash);
  if (
    event.kind !== "movie_rollback_retry_playback_v1" ||
    event.id !== guard.id ||
    event.dedupeKey !== `movie-rollback-retry-playback-v1:${guard.id}` ||
    pointer.guardHash !== envelope.guardHash ||
    event.mediaId !== parent.intent.scope.mediaId ||
    event.actorId !== handoff.command.operation.userId ||
    guard.operationId !== parent.operation.id ||
    guard.intentId !== parent.intent.id ||
    guard.intentHash !== parent.intentHash ||
    identityHash(guard.input) !== identityHash(handoff.handoff.input) ||
    identityHash(guard.handoff) !== identityHash(handoff.reference) ||
    identityHash(guard.originalAssociation) !==
      parent.intent.originalItem.binding.associationHash ||
    identityHash(guard.paths) !==
      identityHash(
        movieRollbackRetryPlaybackPathsV1(
          parent.intent,
          guard.originalAssociation,
        ),
      ) ||
    guard.sessions.pathsHash !== guard.pathsHash ||
    Date.parse(guard.completedAt) > invocation.execution.observed.wall
  )
    throw new Error(
      "Automatic rollback retry lost its actual sessions-last source proof",
    );
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      Date.parse(guard.expiresAt),
    ),
    guards: [invocation.execution],
  });
  freshness.assertActive();
  return { reference: pointer, guard, freshness };
}
