import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import type { MovieInterventionNoticeV4 } from "#shared/movie-editions/intervention/v4.ts";
import { MovieRetryCaptureV1Schema } from "#shared/movie-editions/retry/v1.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** A literal old failure remains acknowledgeable, but cannot send after its acquisition has recovered. */
export async function assertCurrentMovieFailureV4(
  tx: Prisma.TransactionClient,
  payload: MovieInterventionNoticeV4,
  command: Operation,
  budget: PublicationAuthorityReadBudget,
) {
  if (payload.attemptId !== undefined) {
    const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: payload.attemptId },
    });
    budget.consume(1);
    if (
      attempt.coordinatorOperationId !== command.id ||
      attempt.state === "completed"
    )
      throw new PlexBindingProtection("scope_changed");
    return;
  }
  const capture = z
    .object({ movieRetryV1: MovieRetryCaptureV1Schema.optional() })
    .parse(command.payload).movieRetryV1;
  if (capture === undefined) return;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: capture.attemptId },
  });
  budget.consume(1);
  if (
    attempt.coordinatorOperationId !== capture.previousCoordinatorOperationId ||
    attempt.state === "completed"
  )
    throw new PlexBindingProtection("scope_changed");
}
