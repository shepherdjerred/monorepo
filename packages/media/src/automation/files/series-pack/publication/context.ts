import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError, FilePlanSchema } from "#automation/files/types.ts";
import { libraryFileInvocation } from "#automation/acquisition-management/files.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadSeriesPackStagingSealV1 } from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import {
  SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
  SeriesPackPublicationScopeV1Schema,
  type SeriesPackPublicationInputV1,
} from "#shared/acquisition/series-pack-publication-v1.ts";

/** The SDK execution and original allowance are supplied by the actual pre-lazy-load Activity boundary. */
export async function seriesPackPublicationContextV1(
  initial: FileContext,
  input: Omit<SeriesPackPublicationInputV1, "batchIndex">,
  budget: PublicationAuthorityReadBudget,
) {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const staging = await loadSeriesPackStagingSealV1(
    initial.db,
    input.attemptId,
    budget,
  );
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  if (
    staging?.seal.operationId !== input.operationId ||
    attempt.coordinatorOperationId !== input.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const filePlanHash = identityHash(attempt.filePlan);
  if (
    filePlanHash !== staging.seal.filePlanHash ||
    plan.some((entry) => entry.libraryKind !== "tv")
  )
    throw new FileGuardError("series_pack_publication_scope_changed");
  const scope = SeriesPackPublicationScopeV1Schema.parse({
    schemaVersion: 1,
    transitionId: attempt.id,
    attemptId: attempt.id,
    operationId: input.operationId,
    attemptOperationId: attempt.operationId,
    birthEpoch: attempt.recoveryEpoch,
    stagingSeal: {
      operationId: staging.operationId,
      sealHash: staging.sealHash,
    },
    identityHash: staging.seal.scope.identityHash,
    observationHash: staging.seal.scope.observationHash,
    generationsHash: staging.seal.scope.generationsHash,
    filePlanHash,
    mediaIds: [...attempt.mediaIds].sort(),
    entryOperationIds: plan.map((entry) => entry.operationId),
  });
  const context = await libraryFileInvocation(
    publicationInvocation(initial, execution),
    attempt.identityEvidence,
    budget,
  );
  return { context, attempt, plan, scope, budget, staging };
}

export function seriesPackPublicationEntriesV1(
  plan: Awaited<ReturnType<typeof seriesPackPublicationContextV1>>["plan"],
  index: number,
) {
  const entries = plan.slice(
    index * SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
    (index + 1) * SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
  );
  if (entries.length === 0)
    throw new FileGuardError("series_pack_publication_batch_missing");
  return entries;
}
