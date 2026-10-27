import type {
  Prisma,
  AcquisitionAttempt,
  MediaPublicationTransition,
} from "#generated/prisma/client.ts";
import {
  MoviePublicationIntentV2Schema,
  MoviePublicationIntentRefV2Schema,
  MoviePublicationOutcomeV2Schema,
  type MoviePublicationIntentV2,
  type MoviePublicationIntentRefV2,
  type MoviePublicationOutcomeV2,
} from "#shared/movie-editions/publication-v2.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Literal immutable records only; resolving current caption lineage belongs above this reader. */
export async function loadMoviePublicationV2(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.mediaPublicationTransition.findUnique({
    where: { attemptId },
  });
  if (row === null) return null;
  budget.consume(1);
  if (
    hash(row.intent) !== row.intentHash ||
    (row.outcome === null) !== (row.outcomeHash === null) ||
    (row.outcome !== null && hash(row.outcome) !== row.outcomeHash)
  )
    throw new Error("Movie publication literal JSON hash changed");
  const intent = MoviePublicationIntentV2Schema.parse(row.intent);
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  budget.consume(1);
  if (
    hash(attempt.filePlan) !== row.filePlanHash ||
    hash(intent) !== row.intentHash
  )
    throw new Error("Movie publication raw plan or parsed intent changed");
  assertStoredMoviePlan(row, intent, attempt);
  const reference = MoviePublicationIntentRefV2Schema.parse({
    transitionId: row.id,
    intentHash: row.intentHash,
    intent,
  });
  const outcome =
    row.outcome === null
      ? null
      : MoviePublicationOutcomeV2Schema.parse(row.outcome);
  if (outcome !== null) {
    assertOutcomeBinding(reference, outcome);
    if (hash(outcome) !== row.outcomeHash)
      throw new Error(
        "Movie publication outcome projection changed its literal hash",
      );
  }
  return { reference, outcome, attempt, outcomeHash: row.outcomeHash };
}

function assertStoredMoviePlan(
  row: MediaPublicationTransition,
  intent: MoviePublicationIntentV2,
  attempt: AcquisitionAttempt,
) {
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
  const entry = intent.entries[0];
  if (
    hash(plan) !== row.filePlanHash ||
    row.id !== intent.transitionId ||
    row.attemptId !== intent.attemptId ||
    row.birthEpoch !== intent.birthEpoch ||
    row.filePlanHash !== intent.filePlanHash ||
    attempt.recoveryEpoch !== row.birthEpoch ||
    attempt.operationId !== intent.operationId ||
    attempt.edition !== intent.scope.edition ||
    attempt.mediaIds.length !== 1 ||
    attempt.mediaIds[0] !== intent.scope.mediaId ||
    hash(plan.scope) !== hash(intent.scope) ||
    hash(plan.entries[0]) !== entry.entryHash ||
    hash(entry.entry) !== entry.entryHash
  )
    throw new Error("Movie publication original scope, plan or birth changed");
}

export function assertOutcomeBinding(
  parent: MoviePublicationIntentRefV2,
  outcome: MoviePublicationOutcomeV2,
) {
  const intent = parent.intent;
  const result = outcome.entries[0];
  const entry = intent.entries[0].entry;
  if (
    outcome.transitionId !== parent.transitionId ||
    outcome.intentHash !== parent.intentHash ||
    outcome.birthEpoch !== intent.birthEpoch ||
    outcome.filePlanHash !== intent.filePlanHash ||
    hash(outcome.scope) !== hash(intent.scope) ||
    result.entryOperationId !== entry.operationId ||
    (result.predecessor?.id ?? null) !== entry.previousAssetId ||
    (outcome.kind === "published" &&
      (result.successor?.id !== entry.assetId ||
        result.successor.state !== "published")) ||
    (outcome.kind === "compensated" &&
      result.predecessor !== null &&
      result.predecessor.state !== "published") ||
    outcome.effects.some((effect, index) => effect.ordinal !== index)
  )
    throw new Error(
      "Movie publication outcome lost its exact parent or whole-entry lifecycle",
    );
}
