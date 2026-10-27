import type { MediaAutomationContext } from "#automation/context.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { MovieAcquisitionIdentitySchema } from "#shared/movie-editions/management/contracts.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
import { submit } from "#automation/acquisition-submission.ts";
import { acquisitionInvocation } from "./invocation.ts";
import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { z } from "zod";

/** Observe only a journaled uncertain add. All attempts in a sweep retain its original SDK and allowance. */
export async function reconcileUnconfirmedSubmission(
  initial: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const context = movieManagementContext(initial);
  context.plexBindingExecution().assertActive();
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (
    attempt.torrentId !== null ||
    !["submitting", "submission_unknown"].includes(attempt.state)
  )
    return;
  const input = {
    operationId: attempt.coordinatorOperationId ?? attempt.operationId,
    attemptId,
  };
  const identity =
    attempt.identityEvidence === null
      ? null
      : z
          .union([
            DefaultAcquisitionIdentitySchema,
            MovieAcquisitionIdentitySchema,
          ])
          .parse(attempt.identityEvidence);
  const scope =
    identity !== null &&
    (identity.schemaVersion === 2 || identity.schemaVersion === 3)
      ? identity.scope
      : null;
  const result =
    scope === null
      ? await submit(await acquisitionInvocation(context, { attemptId }), input)
      : await submitMovieTorrentV4(context, {
          schemaVersion: 4,
          ...input,
          scope,
        });
  if (result.status === "blocked")
    await context.db.operation.update({
      where: { id: input.operationId },
      data: { status: "reconciling" },
    });
}
