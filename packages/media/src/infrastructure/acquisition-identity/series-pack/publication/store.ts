import type { Prisma } from "#generated/prisma/client.ts";
import {
  SeriesPackPublicationIntentRefV3Schema,
  SeriesPackPublicationIntentV3Schema,
  SeriesPackPublicationOutcomeV3Schema,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadSeriesPackStagingSealV1 } from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import { assertSeriesPackCompletionParentV1 } from "./completion-parent.ts";

type Transition = Prisma.MediaPublicationTransitionGetPayload<
  Record<string, never>
>;

function assertAttemptBinding(input: {
  attempt: Prisma.AcquisitionAttemptGetPayload<Record<string, never>>;
  staging: Awaited<ReturnType<typeof loadSeriesPackStagingSealV1>>;
  row: Transition;
  intent: ReturnType<typeof SeriesPackPublicationIntentV3Schema.parse>;
}) {
  const { attempt, staging, row, intent } = input;
  if (
    staging?.operationId !==
      intent.seriesPackPublication.stagingSeal.operationId ||
    attempt.edition !== "default" ||
    attempt.operationId !== intent.operationId ||
    attempt.recoveryEpoch !== row.birthEpoch ||
    identityHash(attempt.filePlan) !== row.filePlanHash ||
    staging.sealHash !== intent.seriesPackPublication.stagingSeal.sealHash ||
    staging.seal.operationId !==
      intent.seriesPackPublication.coordinatorOperationId ||
    staging.seal.filePlanHash !== row.filePlanHash ||
    identityHash([...attempt.mediaIds].sort()) !==
      identityHash([...intent.mediaIds].sort())
  )
    throw new Error(
      "Series pack publication lost its literal staging parent or attempt",
    );
}

/** The caller charges the actual queried transition; the included attempt and seal are separate parents. */
export async function validateSeriesPackPublicationRowV1(
  tx: Prisma.TransactionClient,
  row: Transition,
  budget: PublicationAuthorityReadBudget,
) {
  const intent = SeriesPackPublicationIntentV3Schema.parse(row.intent);
  if (
    identityHash(row.intent) !== row.intentHash ||
    row.id !== intent.transitionId ||
    row.attemptId !== intent.attemptId ||
    row.filePlanHash !== intent.filePlanHash ||
    row.birthEpoch !== intent.birthEpoch
  )
    throw new Error("Series pack publication raw intent changed");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: row.attemptId },
  });
  budget.consume(1);
  const staging = await loadSeriesPackStagingSealV1(tx, row.attemptId, budget);
  assertAttemptBinding({ attempt, staging, row, intent });
  if ((row.outcome === null) !== (row.outcomeHash === null))
    throw new Error("Series pack publication outcome hash pair changed");
  const outcome =
    row.outcome === null
      ? null
      : SeriesPackPublicationOutcomeV3Schema.parse(row.outcome);
  if (
    outcome !== null &&
    (identityHash(row.outcome) !== row.outcomeHash ||
      outcome.transitionId !== row.id ||
      outcome.intentHash !== row.intentHash ||
      outcome.birthEpoch !== row.birthEpoch ||
      outcome.filePlanHash !== row.filePlanHash)
  )
    throw new Error("Series pack publication raw outcome changed");
  if (outcome !== null)
    await assertSeriesPackCompletionParentV1(
      tx,
      { row, intent, outcome },
      budget,
    );
  return {
    reference: SeriesPackPublicationIntentRefV3Schema.parse({
      transitionId: row.id,
      intentHash: row.intentHash,
      intent,
    }),
    outcome,
    attempt,
  };
}

export async function loadSeriesPackPublicationRecordV1(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.mediaPublicationTransition.findUnique({
    where: { attemptId },
  });
  if (row === null) return null;
  budget.consume(1);
  return validateSeriesPackPublicationRowV1(tx, row, budget);
}
