import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { lockPublicationRows } from "./locks.ts";
import {
  bindLockedPublicationSnapshots,
  type LockedPublicationSnapshots,
} from "./queried-snapshots.ts";

/** One phase's complete physical rows are locked before any cached projection is queried. */
export async function lockPublicationSnapshots(
  tx: Prisma.TransactionClient,
  scope: Parameters<typeof lockPublicationRows>[1],
  budget: PublicationAuthorityReadBudget,
): Promise<LockedPublicationSnapshots> {
  await lockPublicationRows(tx, scope);
  return bindLockedPublicationSnapshots(
    tx,
    scope.entries.flatMap(({ entry }) => [
      entry.assetId,
      ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
    ]),
    budget,
  );
}
