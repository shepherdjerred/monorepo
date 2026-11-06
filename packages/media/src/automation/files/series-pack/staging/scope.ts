import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  loadSeriesPackStagingReceiptV1,
  type SeriesPackStagingReceiptV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/receipts.ts";
import { seriesPackStagingScopeV1 } from "#infrastructure/acquisition-identity/series-pack/staging/scope.ts";
import {
  assertSeriesPackStagingObservationCurrentV1,
  assertSeriesPackStagingAttemptCurrentV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/observation.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { SeriesPackStagingInputV1 } from "#shared/acquisition/series-pack-staging-v1.ts";

/** The first real completed batch is the original-ready parent for every later member. */
export async function retainedSeriesPackStagingScopeV1(
  tx: Prisma.TransactionClient,
  selected: {
    attempt: AcquisitionAttempt;
    observation: unknown;
    input: SeriesPackStagingInputV1;
    own: SeriesPackStagingReceiptV1 | null;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { attempt, observation, input, own } = selected;
  const first =
    input.batchIndex === 0
      ? own
      : await loadSeriesPackStagingReceiptV1(
          tx,
          { attemptId: input.attemptId, batchIndex: 0 },
          budget,
        );
  if (input.batchIndex > 0 && first?.result == null)
    throw new FileGuardError("series_pack_staging_first_batch_required");
  const scope =
    first?.prepared.scope ??
    seriesPackStagingScopeV1(attempt, observation, input.operationId);
  if (scope.operationId !== input.operationId)
    throw new FileGuardError("acquisition_obsolete");
  if (own !== null && own.prepared.scopeHash !== identityHash(scope))
    throw new FileGuardError("series_pack_staging_scope_changed");
  assertSeriesPackStagingAttemptCurrentV1(attempt, scope);
  assertSeriesPackStagingObservationCurrentV1(scope, observation);
  return scope;
}
