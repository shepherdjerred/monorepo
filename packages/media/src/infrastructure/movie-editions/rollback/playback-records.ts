import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieRollbackPlaybackEnvelopeV1Schema } from "#shared/movie-editions/rollback/playback.ts";
import { MovieRollbackPlaybackReferenceV1Schema } from "#shared/movie-editions/rollback/playback-reference.ts";
import type { MovieRollbackPlaybackReferenceV1 } from "#shared/movie-editions/rollback/playback-reference.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { readRequestedMovieRollbackCommandV1 } from "./manual/manual-command-records.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** Literal guard reader. Freshness is enforced by the consuming Files phase;
 * historical admission ACK may retain this original evidence after expiry. */
export async function readRequestedMovieRollbackPlaybackV1(
  tx: Prisma.TransactionClient,
  command: Awaited<ReturnType<typeof readRequestedMovieRollbackCommandV1>>,
  budget: PublicationAuthorityReadBudget,
  historical?: MovieRollbackPlaybackReferenceV1,
) {
  const reference =
    historical === undefined
      ? z
          .object({
            movieRollbackPlaybackV1:
              MovieRollbackPlaybackReferenceV1Schema.optional(),
          })
          .nullable()
          .parse(command.operation.result)?.movieRollbackPlaybackV1
      : MovieRollbackPlaybackReferenceV1Schema.parse(historical);
  if (reference === undefined)
    throw new FileGuardError("movie_rollback_playback_observation_required");
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: reference.eventId },
  });
  budget.consume(1);
  const envelope = MovieRollbackPlaybackEnvelopeV1Schema.parse(event.payload);
  const guard = envelope.guard;
  assertMovieRollbackCanonical(envelope.raw, guard, envelope.guardHash);
  assertMovieRollbackCanonical(
    guard.command.payloadRaw,
    command.operation.payload,
    guard.command.payloadHash,
  );
  assertMovieRollbackCanonical(
    guard.reviewRaw,
    command.expected,
    guard.reviewHash,
  );
  assertMovieRollbackCanonical(guard.pathsRaw, guard.paths, guard.pathsHash);
  if (
    event.kind !== "movie_rollback_playback_v1" ||
    event.id !== guard.id ||
    event.mediaId !== command.source.scope.mediaId ||
    event.actorId !== command.payload.actorId ||
    reference.guardHash !== envelope.guardHash ||
    guard.input.operationId !== command.operation.id ||
    guard.input.sourceAttemptId !== command.source.attemptId ||
    guard.command.actorId !== command.payload.actorId ||
    identityHash(guard.input.scope) !== identityHash(command.source.scope) ||
    identityHash(guard.review) !== identityHash(command.expected) ||
    identityHash(guard.binding) !== identityHash(command.expected.binding) ||
    identityHash(guard.association) !== guard.binding.associationHash ||
    guard.successorPublicationHash !==
      command.expected.successor.publicationHash
  )
    throw new Error(
      "Movie rollback playback guard lost its actual owner command or reviewed current B",
    );
  return { reference, guard };
}
