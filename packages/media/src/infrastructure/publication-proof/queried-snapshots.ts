import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { snapshotPublicationAsset } from "./snapshots.ts";

export type LockedPublicationSnapshots = {
  readonly transaction: Prisma.TransactionClient;
  readonly budget: PublicationAuthorityReadBudget;
};

const held = new WeakMap<
  LockedPublicationSnapshots,
  {
    transaction: Prisma.TransactionClient;
    budget: PublicationAuthorityReadBudget;
    assets: Set<string>;
    snapshots: Map<string, PublicationAssetSnapshot>;
  }
>();

/** The locking entrypoint binds the exact rows it has just locked to this private reader. */
export function bindLockedPublicationSnapshots(
  tx: Prisma.TransactionClient,
  assets: readonly string[],
  budget: PublicationAuthorityReadBudget,
): LockedPublicationSnapshots {
  const token = Object.freeze({ transaction: tx, budget });
  held.set(token, {
    transaction: tx,
    budget,
    assets: new Set(assets),
    snapshots: new Map(),
  });
  return token;
}

/** Only after the phase's writes finish; validators share actual queried rows in this live transaction. */
export async function readLockedPublicationSnapshot(
  tx: Prisma.TransactionClient,
  assetId: string,
  budget: PublicationAuthorityReadBudget | undefined,
  token: LockedPublicationSnapshots,
) {
  const current = held.get(token);
  if (
    current?.transaction !== tx ||
    token.transaction !== tx ||
    current.budget !== budget ||
    token.budget !== budget ||
    !current.assets.has(assetId)
  )
    throw new Error(
      "Publication snapshot belongs to another transaction, allowance or locked scope",
    );
  let snapshot = current.snapshots.get(assetId);
  if (snapshot === undefined) {
    snapshot = await snapshotPublicationAsset(tx, assetId, budget);
    current.snapshots.set(assetId, structuredClone(snapshot));
  } else await tx.$queryRaw`SELECT 1`;
  return structuredClone(snapshot);
}
