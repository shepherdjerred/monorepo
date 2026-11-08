import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import {
  readSeriesPackPreparationV1,
  readSeriesPackPhysicalV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";

/** Actual whole parent closure, owned by this transaction and this original allowance. */
export async function loadSeriesPackNativeParentsV1(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget: PublicationAuthorityReadBudget,
  queried?: {
    transaction: Prisma.TransactionClient;
    budget: PublicationAuthorityReadBudget;
    publication: NonNullable<
      Awaited<ReturnType<typeof loadSeriesPackPublicationRecordV1>>
    >;
  },
) {
  if (
    queried !== undefined &&
    (queried.transaction !== tx ||
      queried.budget !== budget ||
      queried.publication.reference.intent.attemptId !== attemptId)
  )
    throw new Error(
      "Native pack original parent belongs to another held transaction/scope/allowance",
    );
  const publication =
    queried?.publication ??
    (await loadSeriesPackPublicationRecordV1(tx, attemptId, budget));
  if (publication?.outcome !== null)
    throw new NativeCompensationProtection(
      "compensation_whole_transition_unavailable",
    );
  const intent = publication.reference.intent;
  if (
    intent.entries.length > 25 ||
    intent.entries.some(
      (item) => item.predecessor === null || item.entry.libraryKind !== "tv",
    )
  )
    throw new NativeCompensationProtection("compensation_scope_exceeds_limit");
  const prepareRows = await tx.operation.findMany({
    where: {
      id: {
        in: intent.seriesPackPublication.preparations.map(
          (ref) => ref.operationId,
        ),
      },
    },
    take: budget.take,
  });
  budget.consume(prepareRows.length);
  const preparations = prepareRows
    .map((row) => readSeriesPackPreparationV1(row))
    .sort((a, b) => a.prepared.batchIndex - b.prepared.batchIndex);
  if (
    preparations.length !== intent.seriesPackPublication.preparations.length ||
    preparations.some((row, index) => {
      const ref = intent.seriesPackPublication.preparations[index];
      return (
        row.operationId !== ref?.operationId ||
        row.preparedHash !== ref.preparedHash ||
        row.prepared.batchIndex !== index ||
        row.prepared.scope.attemptId !== attemptId ||
        row.prepared.scope.operationId !==
          intent.seriesPackPublication.coordinatorOperationId ||
        row.prepared.scope.birthEpoch !== intent.birthEpoch ||
        row.prepared.scope.filePlanHash !== intent.filePlanHash
      );
    }) ||
    identityHash(preparations.flatMap((row) => row.prepared.entries)) !==
      identityHash(intent.entries) ||
    preparations.some(
      (row) =>
        identityHash(row.prepared.scope) !==
        identityHash(preparations[0]?.prepared.scope),
    )
  )
    throw new Error(
      "Native pack recovery lost its actual complete preparation parents",
    );
  const forwardRows = await tx.operation.findMany({
    where: { kind: "publish_series_pack_members_v1", targetId: attemptId },
    take: budget.take,
  });
  budget.consume(forwardRows.length);
  const forward = forwardRows
    .map((row) => readSeriesPackPhysicalV1(row))
    .sort((a, b) => a.command.batchIndex - b.command.batchIndex);
  if (
    forward.length > preparations.length ||
    forward.some((row, index) => {
      const prior = forward[index - 1];
      const expected = intent.entries
        .slice(index * 4, index * 4 + 4)
        .map((item) => item.entry.operationId);
      return (
        row.command.batchIndex !== index ||
        row.command.attemptId !== attemptId ||
        row.command.transitionId !== publication.reference.transitionId ||
        row.command.intentHash !== publication.reference.intentHash ||
        row.command.operationId !==
          intent.seriesPackPublication.coordinatorOperationId ||
        identityHash(row.command.entryOperationIds) !==
          identityHash(expected) ||
        prior?.completion.effects.some(
          (effect, ordinal) =>
            identityHash(effect) !==
            identityHash(row.completion.effects[ordinal]),
        ) === true
      );
    })
  )
    throw new Error(
      "Native pack recovery forward parents are partial, foreign or noncontiguous",
    );
  return { transaction: tx, budget, publication, preparations, forward };
}

export type SeriesPackNativeParentsV1 = Awaited<
  ReturnType<typeof loadSeriesPackNativeParentsV1>
>;
