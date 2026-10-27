import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readMovieAttemptIdentityV4 } from "./attempt-identity.ts";
import { MovieBirthAuthoritySchema } from "#shared/movie-editions/management/contracts.ts";

/** Caller holds the canonical target and request locks. No transfer or file is removed. */
export async function releaseCancelledMovieReservationV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  requestId: string | null,
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
  if (requestId === null) {
    if (
      await managedReservationCurrent(tx, attempt.movieEditionAuthority, scope)
    )
      return;
  } else {
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
  }
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

async function managedReservationCurrent(
  tx: Prisma.TransactionClient,
  raw: unknown,
  scope: MovieEditionScope,
) {
  const birth = MovieBirthAuthoritySchema.parse(raw);
  if (birth.schemaVersion !== 2)
    throw new Error("Acquisition without a request lost its management birth");
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: birth.actorId },
  });
  const profile =
    target.profileId === null
      ? null
      : await tx.qualityProfile.findUniqueOrThrow({
          where: { id: target.profileId },
        });
  return (
    target.desiredPresence &&
    target.monitoring &&
    target.intentionallyRemovedAt === null &&
    target.generation === birth.targetGenerationAtCapture &&
    target.automationEpoch === birth.birthEpoch &&
    owner.role === "owner" &&
    !owner.restricted &&
    profile?.id === birth.profileId &&
    profile.version === birth.profileVersionAtCapture
  );
}
