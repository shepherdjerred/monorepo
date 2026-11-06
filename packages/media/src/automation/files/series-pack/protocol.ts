import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { seriesPackIdentityV1 } from "#shared/acquisition/library-management.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export type SeriesPackPublicationOptions = {
  operationId?: string;
  seriesPackPhase?: "prepare" | "publish";
  budget?: PublicationAuthorityReadBudget;
};

export function publicationReadBudget(
  context: FileContext,
  options?: SeriesPackPublicationOptions,
) {
  return (
    options?.budget ??
    context.libraryManagement?.budget ??
    new PublicationAuthorityReadBudget()
  );
}

export function seriesPackPublicationPhase(
  attempt: AcquisitionAttempt,
  options?: SeriesPackPublicationOptions,
) {
  if (seriesPackIdentityV1(attempt.identityEvidence) === null) {
    if (options?.seriesPackPhase !== undefined)
      throw new FileGuardError("series_pack_publication_required");
    return;
  }
  if (
    options?.operationId === undefined ||
    attempt.coordinatorOperationId !== options.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  return options.seriesPackPhase ?? "publish";
}
