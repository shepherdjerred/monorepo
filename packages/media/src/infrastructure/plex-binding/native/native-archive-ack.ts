import type { Prisma } from "#generated/prisma/client.ts";
import {
  CleanupNativeArchiveInputSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import { assertArchiveImmutableCompletion } from "#infrastructure/native-archive/completion.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { validateNativePlexReceipt } from "./native-version.ts";

/** Negative terminal discovery grants nothing. Exact historical ACK needs no current config or asset lookup. */
export async function readCompletedNativeArchiveCleanup(
  tx: Prisma.TransactionClient,
  input: CleanupNativeArchiveInput,
  budget = new PublicationAuthorityReadBudget(),
): Promise<true | null> {
  const initial = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
    select: {
      state: true,
      completion: true,
      coordinatorOperationId: true,
      recoveryEpoch: true,
    },
  });
  budget.consume(1);
  if (
    initial.state !== "cleaned" ||
    initial.completion === null ||
    initial.coordinatorOperationId !== input.operationId ||
    initial.recoveryEpoch !== input.recoveryEpoch
  )
    return null;
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
    include: { receipt: { include: { plan: true } } },
  });
  budget.consume(3);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  if (
    row.coordinatorOperationId !== input.operationId ||
    row.recoveryEpoch !== input.recoveryEpoch ||
    operation.kind !== "cleanup_native_archive" ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    identityHash(CleanupNativeArchiveInputSchema.parse(operation.payload)) !==
      identityHash(input)
  )
    throw new Error("Native completed archive command changed");
  assertArchiveImmutableCompletion(row);
  await validateNativePlexReceipt(tx, row.receipt, budget);
  return true;
}
