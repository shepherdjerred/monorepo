import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Bounded display admission only; actual Retry still proves both real Temporal terminal histories. */
export async function movieOperationalAdmissionV4(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; generation: number; actorId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const selected = {
    mediaId: input.scope.mediaId,
    edition: input.scope.edition,
  };
  const hold = await tx.recoveryHold.findUnique({
    where: { mediaId_edition: selected },
  });
  const personal = await tx.mediaRequest.count({
    where: {
      ...selected,
      active: true,
      excluded: false,
      direct: true,
      movieEditionChoiceId: { not: null },
    },
  });
  budget.consume(personal);
  const facts = {
    recoveryHeld: hold !== null && hold.releasedAt === null,
    personalDemand: personal > 0,
  };
  const reservation = await tx.acquisitionReservation.findUnique({
    where: { mediaId_edition: selected },
    include: {
      attempt: {
        select: {
          coordinatorOperationId: true,
          sponsorRequestId: true,
          movieEditionChoiceId: true,
          movieEditionChoiceRevision: true,
          movieEditionAuthority: true,
        },
      },
    },
  });
  if (reservation === null)
    return { ...facts, reserved: false, retryable: false };
  budget.consume(2);
  const retryable = await retryableMovieCoordinatorV4(
    tx,
    { ...input, attempt: reservation.attempt },
    budget,
  );
  return { ...facts, reserved: true, retryable };
}

async function retryableMovieCoordinatorV4(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof movieOperationalAdmissionV4>[1] & {
    attempt: {
      coordinatorOperationId: string | null;
      sponsorRequestId: string | null;
      movieEditionChoiceId: string | null;
      movieEditionChoiceRevision: number | null;
      movieEditionAuthority: unknown;
    };
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.attempt.coordinatorOperationId === null) return false;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.attempt.coordinatorOperationId },
  });
  budget.consume(1);
  if (
    !["reconcile_movie_edition_v4", "acquire_movie_edition_v4"].includes(
      operation.kind,
    )
  )
    return false;
  const source = z
    .object(MovieOperationV4Schema.shape)
    .parse(operation.payload);
  if (
    operation.targetId !== input.scope.mediaId ||
    operation.id !== source.operationId ||
    source.mediaId !== input.scope.mediaId ||
    identityHash(source.scope) !== identityHash(input.scope)
  )
    throw new Error(
      "Movie retry display coordinator changed its actual selected scope",
    );
  const actor = z
    .object({ actorId: z.uuid() })
    .parse(input.attempt.movieEditionAuthority);
  if (
    actor.actorId !== input.actorId ||
    source.generation !== input.generation ||
    !["failed", "cancelled", "reconciling", "obsolete"].includes(
      operation.status,
    )
  )
    return false;
  if (input.attempt.sponsorRequestId === null) return true;
  const request = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: input.attempt.sponsorRequestId },
  });
  budget.consume(1);
  return (
    request.active &&
    !request.excluded &&
    request.direct &&
    request.movieEditionChoiceId === input.attempt.movieEditionChoiceId &&
    request.movieEditionChoiceRevision ===
      input.attempt.movieEditionChoiceRevision
  );
}
