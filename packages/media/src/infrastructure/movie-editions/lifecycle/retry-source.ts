import { z } from "zod";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { MovieRetryCaptureV1Schema } from "#shared/movie-editions/retry/v1.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieAttemptIdentityV4 } from "./attempt-identity.ts";

export const RetryProfile = z.object({
  profileId: z.uuid(),
  profileVersion: z.int().nonnegative(),
});
const RetryState = z.enum([
  "reserved",
  "submitting",
  "submission_unknown",
  "submission_observed",
  "downloading",
]);

export function movieRetryBirthHash(attempt: AcquisitionAttempt) {
  const profile = RetryProfile.parse(attempt.failure);
  return identityHash({
    id: attempt.id,
    operationId: attempt.operationId,
    releaseId: attempt.releaseId,
    sponsorRequestId: attempt.sponsorRequestId,
    mediaIds: attempt.mediaIds,
    edition: attempt.edition,
    generations: attempt.generations,
    recoveryEpoch: attempt.recoveryEpoch,
    createdAt: attempt.createdAt.toISOString(),
    identityEvidence: attempt.identityEvidence,
    movieEditionChoiceId: attempt.movieEditionChoiceId,
    movieEditionChoiceRevision: attempt.movieEditionChoiceRevision,
    movieEditionAuthority: attempt.movieEditionAuthority,
    profile,
  });
}

/** No plan or receipt is reinterpreted as a fresh attempt. Prepared/publication recovery is a later explicit protocol. */
export async function readMovieRetrySourceV4(
  tx: Prisma.TransactionClient,
  input: { attemptId: string; scope: MovieEditionScope },
  budget: PublicationAuthorityReadBudget,
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  budget.consume(1 + (attempt.torrent === null ? 0 : 1));
  if (attempt.filePlan !== null)
    throw new MediaError(
      "movie_retry_prepared_publication",
      "Prepared movie publication requires its exact continuation authority",
      409,
    );
  const state = RetryState.safeParse(attempt.state);
  if (!state.success)
    throw new MediaError(
      "movie_retry_attempt_terminal",
      "This acquisition state cannot renew its coordinator",
      409,
    );
  if (attempt.coordinatorOperationId === null)
    throw new Error("V4 movie acquisition omitted its current coordinator");
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
      "Movie retry source coordinator differs from its literal attempt scope",
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
    throw new Error("Movie retry source lost its original assessment profile");
  return {
    attempt,
    operation,
    state: state.data,
    recorded,
    generation,
    profile: { id: profile.profileId, version: profile.profileVersion },
    birthHash: movieRetryBirthHash(attempt),
  };
}

export function captureMovieRetryV1(
  source: Awaited<ReturnType<typeof readMovieRetrySourceV4>>,
  mode: "manual" | "automatic",
) {
  return MovieRetryCaptureV1Schema.parse({
    schemaVersion: 1,
    mode,
    attemptId: source.attempt.id,
    previousCoordinatorOperationId: source.operation.id,
    birthHash: source.birthHash,
    generation: source.generation,
    recoveryEpoch: source.attempt.recoveryEpoch,
    profile: source.profile,
  });
}
