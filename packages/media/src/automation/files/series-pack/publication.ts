import { z } from "zod";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import { seriesPackIdentityV1 } from "#shared/acquisition/library-management.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { promote } from "#automation/files/publication.ts";

/** A separate Activity commits the exact intent without performing forward publication effects. */
export async function prepareSeriesPackPublicationV1(
  initial: FileContext,
  raw: MediaAttemptOperation,
  suppliedBudget?: PublicationAuthorityReadBudget,
): Promise<void> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const budget =
    suppliedBudget ??
    initial.libraryManagement?.budget ??
    new PublicationAuthorityReadBudget();
  const input = z
    .strictObject({ operationId: z.uuid(), attemptId: z.uuid() })
    .parse(raw);
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  if (seriesPackIdentityV1(attempt.identityEvidence) === null)
    throw new FileGuardError("series_pack_publication_required");
  if (attempt.coordinatorOperationId !== input.operationId)
    throw new FileGuardError("acquisition_obsolete");
  execution.assertActive();
  await promote(
    { ...initial, publicationExecution: () => execution },
    input.attemptId,
    { operationId: input.operationId, seriesPackPhase: "prepare", budget },
  );
}
