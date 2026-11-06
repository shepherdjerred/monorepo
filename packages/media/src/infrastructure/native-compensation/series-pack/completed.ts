import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { SeriesPackNativeActivityV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";

/** ACK validates the actual immutable receipt and literal old command before
 * any new owner, policy, storage or Network permission is requested. */
export async function readSeriesPackNativeCompletedV1(
  tx: Prisma.TransactionClient,
  input: SeriesPackNativeActivityV1,
  budget: PublicationAuthorityReadBudget,
) {
  const locator =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: {
        completion: true,
        state: true,
        coordinatorOperationId: true,
        recoveryEpoch: true,
      },
    });
  budget.consume(1);
  if (locator.completion === null) return null;
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    input.continuationId,
    budget,
  );
  if (
    record.completion === null ||
    record.row.state !== "compensated" ||
    record.row.coordinatorOperationId !== input.operationId ||
    record.row.recoveryEpoch !== input.recoveryEpoch ||
    locator.coordinatorOperationId !== input.operationId ||
    locator.recoveryEpoch !== input.recoveryEpoch
  )
    throw new Error(
      "Completed native pack ACK has another literal execution command",
    );
  return record;
}
