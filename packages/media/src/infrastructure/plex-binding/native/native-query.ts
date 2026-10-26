import type { Prisma } from "#generated/prisma/client.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativeCatalogScopeSnapshot } from "#shared/plex-binding/native-scope.ts";

export type QueriedNativePlan = {
  transaction: Prisma.TransactionClient;
  budget: PublicationAuthorityReadBudget;
  plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>;
};
export type NativeReceiptRow = Prisma.NativeRecoveryReceiptGetPayload<{
  include: { plan: true };
}>;
export type CompensationBatchPhase = {
  transaction: Prisma.TransactionClient;
  budget: PublicationAuthorityReadBudget;
  closed: boolean;
  operation: Prisma.OperationGetPayload<Record<string, never>>;
  authority: {
    continuationId: string;
    networkScope: NativeCatalogScopeSnapshot;
  };
  chain: readonly {
    row: Prisma.NativePublicationCompensationContinuationGetPayload<{
      include: { receipt: { include: { plan: true } }; transition: true };
    }>;
  }[];
};
export type ArchiveBatchPhase = {
  transaction: Prisma.TransactionClient;
  budget: PublicationAuthorityReadBudget;
  closed: boolean;
  operation: Prisma.OperationGetPayload<Record<string, never>>;
  projection: {
    validateQueried: (
      tx: Prisma.TransactionClient,
      row: NativeReceiptRow,
      budget: PublicationAuthorityReadBudget,
    ) => Promise<NativeReceiptRow>;
  };
  authority: {
    row: Prisma.NativeArchiveCleanupContinuationGetPayload<{
      include: { receipt: { include: { plan: true } } };
    }>;
    networkScope: NativeCatalogScopeSnapshot;
  };
};
export type NativeBatchRow = Prisma.NativePlexProofBatchGetPayload<{
  include: {
    plan: true;
    operation: true;
    networkObservation: true;
    plexObservation: true;
  };
}>;

/** Only an actual same-transaction parent removes its duplicate SQL relation. */
export async function queryNativeBatch(
  tx: Prisma.TransactionClient,
  ref: NativePlexProofRef,
  {
    budget,
    queriedPlan,
  }: {
    budget: PublicationAuthorityReadBudget;
    queriedPlan?: QueriedNativePlan;
  },
): Promise<NativeBatchRow> {
  if (queriedPlan !== undefined) {
    if (
      queriedPlan.transaction !== tx ||
      queriedPlan.budget !== budget ||
      queriedPlan.plan.id !== ref.parent.planId
    )
      throw new Error(
        "Native batch plan belongs to another transaction, budget or parent",
      );
    const row = await tx.nativePlexProofBatch.findUniqueOrThrow({
      where: { id: ref.batchId },
      include: {
        operation: true,
        networkObservation: true,
        plexObservation: true,
      },
    });
    budget.consume(4);
    if (row.planId !== queriedPlan.plan.id)
      throw new Error("Native batch queried plan changed");
    return { ...row, plan: queriedPlan.plan };
  }
  const row = await tx.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
    include: {
      plan: true,
      operation: true,
      networkObservation: true,
      plexObservation: true,
    },
  });
  budget.consume(5);
  return row;
}
