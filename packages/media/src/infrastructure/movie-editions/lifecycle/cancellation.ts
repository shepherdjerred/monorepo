import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readMovieAttemptIdentityV4 } from "./attempt-identity.ts";

/** Caller holds the canonical target and request locks. No transfer or file is removed. */
export async function releaseCancelledMovieReservationV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  requestId: string,
) {
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
    include: { attempt: true },
  });
  if (reservation?.attempt.sponsorRequestId !== requestId) return;
  const attempt = reservation.attempt;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: attempt.operationId },
  });
  if (
    operation.kind !== "reconcile_movie_edition_v4" &&
    operation.kind !== "acquire_movie_edition_v4"
  )
    return;
  // An uncertain add must first record its actual outcome and independent seeding
  // responsibility. A prepared publication retains its reservation for recovery.
  if (
    attempt.filePlan !== null ||
    ["submitting", "submission_unknown", "imported", "completed"].includes(
      attempt.state,
    )
  )
    return;
  const request = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  if (
    request.active &&
    !request.excluded &&
    request.direct &&
    request.movieEditionChoiceId === attempt.movieEditionChoiceId &&
    request.movieEditionChoiceRevision === attempt.movieEditionChoiceRevision
  )
    return;
  if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return;
  await readMovieAttemptIdentityV4(tx, attempt, scope);
  if (attempt.state !== "failed" && attempt.state !== "cancelled")
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "cancelled" },
    });
  await tx.acquisitionReservation.deleteMany({
    where: {
      attemptId: attempt.id,
      mediaId: scope.mediaId,
      edition: scope.edition,
    },
  });
}
