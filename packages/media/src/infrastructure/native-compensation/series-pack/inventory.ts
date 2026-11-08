import { z } from "zod";
import { compensationInventoryItem } from "#infrastructure/native-compensation/inventory/item.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeCompensationInventorySchema } from "#shared/native-recovery/compensation-runtime.ts";
import { loadPublicationIntentRecord } from "#infrastructure/publication-proof/store.ts";
import { readVerifiedCompensationPublication } from "#infrastructure/native-compensation/publication-receipt.ts";

type Transition = Prisma.MediaPublicationTransitionGetPayload<
  Record<string, never>
>;

export function hasSeriesPackNativeInventoryV1(rows: readonly Transition[]) {
  return rows.some(
    (row) =>
      z.object({ schemaVersion: z.literal(3) }).safeParse(row.intent).success,
  );
}

function protection(input: {
  tooLarge: boolean;
  current: number;
  previous: boolean;
  released: boolean;
  committed: boolean;
  missingPredecessor: boolean;
}) {
  if (input.tooLarge) return "compensation_scope_exceeds_limit";
  if (input.current > 0) return "compensation_current_authority_already_exists";
  if (input.previous)
    return "compensation_prior_native_protocol_requires_ancestry";
  if (input.released)
    return "compensation_already_published_use_native_recovery";
  if (input.committed) return "compensation_transition_already_committed";
  return input.missingPredecessor ? "compensation_predecessor_missing" : null;
}

/** A page containing v3 handles exactly its first complete target. The API
 * caller pays ALL actual lookahead locators and every subsequent grant parent;
 * advancing only that first ID cannot skip old/new siblings on a mixed page. */
export async function seriesPackNativeInventoryPageV1(
  tx: Prisma.TransactionClient,
  input: { rows: readonly Transition[]; recoveryEpoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  budget.consume(input.rows.length);
  const row = input.rows[0];
  if (row === undefined)
    throw new Error("Native pack inventory omitted its actual first candidate");
  const newProtocol = hasSeriesPackNativeInventoryV1([row]);
  const stored = await loadPublicationIntentRecord(tx, row.attemptId, budget);
  const reference = stored?.reference;
  if (reference?.transitionId !== row.id)
    throw new Error("Native pack inventory publication parent changed");
  const intent = reference.intent;
  const ids = new Set(
    intent.entries.flatMap(({ entry }) => [
      entry.assetId,
      ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
    ]),
  );
  const current = await tx.nativePublicationCompensationContinuation.count({
    where: { transitionId: row.id, recoveryEpoch: input.recoveryEpoch },
  });
  const previous = await tx.nativePublicationCompensationContinuation.findFirst(
    {
      where: { transitionId: row.id },
      orderBy: { recoveryEpoch: "desc" },
    },
  );
  if (previous !== null) budget.consume(1);
  if (
    !newProtocol &&
    previous?.fenceRelease != null &&
    (previous.publicationCoordinatorOperationId === null ||
      (await readVerifiedCompensationPublication(
        tx,
        {
          schemaVersion: 1,
          continuationId: previous.id,
          operationId: previous.publicationCoordinatorOperationId,
          recoveryEpoch: previous.recoveryEpoch,
        },
        budget,
      )) === null)
  )
    throw new Error("Released latest compensation has no verified publication");
  const successors = await tx.libraryAsset.count({
    where: { id: { in: intent.entries.map((item) => item.entry.assetId) } },
  });
  const reason = protection({
    tooLarge: newProtocol
      ? intent.entries.length > 25 || ids.size > 50
      : ids.size > 25,
    current,
    previous: newProtocol && previous !== null,
    released: previous?.fenceRelease != null,
    committed: row.outcome !== null || successors > 0,
    missingPredecessor: intent.entries.some(
      (item) => item.predecessor === null,
    ),
  });
  const media = await tx.mediaItem.findMany({
    where: { id: { in: intent.mediaIds } },
    select: { id: true, title: true },
    orderBy: { id: "asc" },
  });
  return NativeCompensationInventorySchema.parse({
    items: [
      {
        ...compensationInventoryItem({
          transition: row,
          media,
          entries: intent.entries,
        }),
        selectable: reason === null,
        protection: reason,
      },
    ],
    nextCursor: input.rows.length > 1 ? row.id : null,
  });
}
