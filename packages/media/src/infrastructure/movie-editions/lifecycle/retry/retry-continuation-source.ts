import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieRetryPlexCaptureV1Schema,
  MovieRetryCaptureV2Schema,
} from "#shared/movie-editions/retry/v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  movieRetryBirthHash,
  RetryProfile,
} from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { captureMovieRetryContinuationV2 } from "#infrastructure/movie-editions/lifecycle/retry/retry-continuation-parents.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MediaError } from "#application/errors.ts";

/** Classifies only actual prepared/imported parents. The old no-plan V1 reader remains literal. */
export async function readMoviePreparedRetrySourceV2(
  tx: Prisma.TransactionClient,
  input: {
    attemptId: string;
    scope: MovieEditionScope;
    mode: "manual" | "automatic";
  },
  budget: PublicationAuthorityReadBudget,
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  budget.consume(1 + (attempt.torrent === null ? 0 : 1));
  if (
    attempt.filePlan === null ||
    !["validating", "imported", "completed"].includes(attempt.state)
  )
    throw new MediaError(
      "movie_retry_continuation_scope",
      "This acquisition has no actual prepared movie continuation",
      409,
    );
  if (attempt.coordinatorOperationId === null)
    throw new Error("Prepared movie retry has no actual coordinator");
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: attempt.coordinatorOperationId },
  });
  budget.consume(1);
  const raw = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.enum(["reconcile_movie_edition_v4", "acquire_movie_edition_v4"]),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const generation = z
    .record(z.string(), z.int().nonnegative())
    .parse(attempt.generations)[input.scope.mediaId];
  if (
    raw.operationId !== operation.id ||
    operation.kind !== raw.kind ||
    operation.targetId !== input.scope.mediaId ||
    raw.recoveryEpoch !== attempt.recoveryEpoch ||
    raw.generation !== generation ||
    identityHash(raw.scope) !== identityHash(input.scope)
  )
    throw new Error(
      "Prepared movie coordinator changed its actual original scope",
    );
  const recorded = await readMovieAttemptIdentityV4(
    tx,
    attempt,
    input.scope,
    budget,
  );
  const profile = RetryProfile.parse(attempt.failure);
  if (
    recorded.assessment.profile.id !== profile.profileId ||
    recorded.assessment.profile.version !== profile.profileVersion
  )
    throw new Error(
      "Prepared movie retry lost its original assessment profile",
    );
  const birthHash = movieRetryBirthHash(attempt);
  const source = {
    attempt,
    operation,
    recorded,
    generation,
    profile: { id: profile.profileId, version: profile.profileVersion },
    birthHash,
  };
  const originalInput = {
    schemaVersion: 4 as const,
    operationId: operation.id,
    attemptId: attempt.id,
    scope: input.scope,
  };
  // A real committed receipt is classified before comparing current physical publication timestamps.
  const completed = await readMoviePlexReceiptV2(tx, originalInput, budget);
  if (completed !== null)
    return {
      kind: "plex_committed" as const,
      source,
      capture: MovieRetryPlexCaptureV1Schema.parse({
        schemaVersion: 1,
        mode: input.mode,
        originalInput,
        originalReceiptHash: identityHash(completed),
        originalCommandHash: identityHash(operation.payload),
        birthHash,
        generation,
        recoveryEpoch: attempt.recoveryEpoch,
      }),
    };
  if (attempt.state === "completed")
    throw new Error(
      "Completed movie retry lost its actual committed Plex receipt",
    );
  const continuation = await captureMovieRetryContinuationV2(
    tx,
    { attempt, scope: input.scope },
    budget,
  );
  return {
    kind: "continuation" as const,
    source,
    capture: MovieRetryCaptureV2Schema.parse({
      schemaVersion: 2,
      mode: input.mode,
      attemptId: attempt.id,
      previousCoordinatorOperationId: operation.id,
      birthHash,
      generation,
      recoveryEpoch: attempt.recoveryEpoch,
      profile: source.profile,
      continuation,
    }),
  };
}
