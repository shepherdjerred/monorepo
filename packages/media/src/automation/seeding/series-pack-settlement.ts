import type { Prisma } from "#generated/prisma/client.ts";
import type { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import { readSeriesPackInverseV1 } from "#infrastructure/acquisition-identity/series-pack/publication/inverse-receipts.ts";
import { readPlexRollbackAttempt } from "#infrastructure/plex-binding/rollback.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
  type SeriesPackPublicationOutcomeV3,
} from "#shared/acquisition/series-pack-publication-v1.ts";

export type SeriesPackSourceParentV1 = NonNullable<
  Awaited<ReturnType<typeof loadSeriesPackPublicationRecordV1>>
>;

/** Only a real immutable whole outcome grants a terminal source interpretation. */
export async function seriesPackSourceSettlementV1(
  tx: Prisma.TransactionClient,
  parent: SeriesPackSourceParentV1,
  budget: PublicationAuthorityReadBudget,
) {
  if (parent.outcome?.kind === "published")
    return publishedSettlement(tx, parent, budget);
  if (
    parent.attempt.state !== "obsolete" ||
    parent.outcome?.kind !== "compensated"
  )
    return null;
  const refs = parent.outcome.seriesPackPublication.compensationReceipts;
  const batches =
    parent.reference.intent.seriesPackPublication.preparations.length;
  if (
    refs?.length !== batches ||
    refs.some((ref, index) => ref.batchIndex !== index) ||
    new Set(refs.map((ref) => ref.operationId)).size !== refs.length
  )
    return null;
  const rows = await tx.operation.findMany({
    where: {
      id: { in: refs.map((ref) => ref.operationId) },
      kind: "compensate_series_pack_members_v1",
    },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length !== refs.length) return null;
  const inverse = rows
    .map((row) => readSeriesPackInverseV1(row))
    .sort((a, b) => a.command.batchIndex - b.command.batchIndex);
  for (const [index, receipt] of inverse.entries()) {
    const ref = refs[index];
    if (
      ref === undefined ||
      !inverseMatches(receipt, { parent, outcome: parent.outcome, index, ref })
    )
      return null;
  }
  const last = inverse.at(-1);
  if (
    last === undefined ||
    identityHash(last.completion.effects) !==
      identityHash(parent.outcome.effects) ||
    !unchangedOutcome(parent, parent.outcome)
  )
    return null;
  return {
    mode: "compensated" as const,
    plan: parent.reference.intent.entries.map((row) => row.entry),
  };
}

async function publishedSettlement(
  tx: Prisma.TransactionClient,
  parent: SeriesPackSourceParentV1,
  budget: PublicationAuthorityReadBudget,
) {
  if (parent.attempt.state === "completed")
    return {
      mode: "completed" as const,
      plan: parent.reference.intent.entries.map((row) => row.entry),
    };
  if (parent.attempt.state !== "rolled_back") return null;
  budget.consume(2); // Actual rollback attempt and original birth Operation.
  const restored = await readPlexRollbackAttempt(tx, parent.attempt.id);
  return identityHash(restored.attempt.filePlan) ===
    parent.reference.intent.filePlanHash
    ? { mode: "rolled_back" as const, plan: restored.plan }
    : null;
}

function unchangedOutcome(
  parent: SeriesPackSourceParentV1,
  outcome: SeriesPackPublicationOutcomeV3,
) {
  const entries = parent.reference.intent.entries;
  return (
    outcome.entries.length === entries.length &&
    new Set(outcome.entries.map((row) => row.entryOperationId)).size ===
      entries.length &&
    outcome.entries.every((entry) => {
      const before = entries.find(
        (row) => row.entry.operationId === entry.entryOperationId,
      );
      return (
        before !== undefined &&
        entry.successor === null &&
        identityHash(entry.predecessor) === identityHash(before.predecessor)
      );
    })
  );
}

function inverseMatches(
  receipt: ReturnType<typeof readSeriesPackInverseV1>,
  input: {
    parent: SeriesPackSourceParentV1;
    outcome: SeriesPackPublicationOutcomeV3;
    index: number;
    ref: { operationId: string; completionHash: string };
  },
) {
  const { parent, outcome, index, ref } = input;
  const expected = parent.reference.intent.entries.slice(
    index * SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
    (index + 1) * SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
  );
  return (
    ref.operationId === receipt.operationId &&
    ref.completionHash === receipt.completionHash &&
    receipt.command.batchIndex === index &&
    receipt.command.attemptId === parent.attempt.id &&
    receipt.command.operationId ===
      parent.reference.intent.seriesPackPublication.coordinatorOperationId &&
    receipt.command.transitionId === parent.reference.transitionId &&
    receipt.command.intentHash === parent.reference.intentHash &&
    identityHash(receipt.command.entryOperationIds) ===
      identityHash(expected.map((row) => row.entry.operationId)) &&
    identityHash(receipt.completion.effects) ===
      identityHash(
        outcome.effects.slice(0, receipt.completion.effects.length),
      ) &&
    receipt.completion.entries.every((entry) => {
      const sealed = outcome.entries.find(
        (row) => row.entryOperationId === entry.entryOperationId,
      );
      return (
        sealed !== undefined &&
        identityHash(sealed.participants) ===
          identityHash(entry.participants) &&
        identityHash(sealed.journals) === identityHash(entry.journals)
      );
    })
  );
}
