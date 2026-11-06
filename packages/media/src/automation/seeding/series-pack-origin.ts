import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  seriesPackLibraryRollbackOriginsV1,
  loadSeriesPackLibraryRollbackOriginsV1,
  assertSeriesPackLibraryPredecessorV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/rollback-origin.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { SeriesPackSourceParentV1 } from "./series-pack-settlement.ts";

export function completedSeriesPackSourceGroupV1(
  parent: SeriesPackSourceParentV1,
) {
  return (group: PlexPhysicalGroup) => {
    const snapshot = parent.outcome?.entries.find(
      (row) => row.successor?.id === group.assetId,
    )?.successor;
    return snapshot != null && sameSnapshotGroup(snapshot, group);
  };
}

/** Uncommitted inverse preserves literal original versions; committed rollback
 * has a distinct genuine +2 lifecycle. Neither is normalized into the other. */
export async function seriesPackSourceLibraryOriginsV1(
  tx: Prisma.TransactionClient,
  input: {
    identity: unknown;
    epoch: number;
    mode: "rolled_back" | "compensated";
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.mode === "rolled_back")
    return seriesPackLibraryRollbackOriginsV1(tx, input, budget);
  const originals = await loadSeriesPackLibraryRollbackOriginsV1(
    tx,
    input,
    budget,
  );
  if (originals === null) return null;
  return (
    group: PlexPhysicalGroup,
    predecessor: PublicationAssetSnapshot | null,
  ) => {
    const original = originals.get(group.assetId);
    if (original === undefined) return false;
    assertSeriesPackLibraryPredecessorV1(original, predecessor);
    return sameSnapshotGroup(original, group);
  };
}

function sameSnapshotGroup(
  snapshot: PublicationAssetSnapshot,
  group: PlexPhysicalGroup,
) {
  return (
    group.assetVersion === snapshot.version &&
    group.checksum === snapshot.checksum &&
    group.canonicalPath === snapshot.path &&
    group.sizeBytes === snapshot.sizeBytes &&
    group.ownershipEpoch === snapshot.ownershipEpoch &&
    group.canonicalRootId === snapshot.editionRootId &&
    group.edition === snapshot.edition &&
    identityHash(group.coverage) ===
      identityHash(
        snapshot.coverage
          .filter((row) => row.current)
          .map(({ mediaId, edition }) => ({ mediaId, edition })),
      )
  );
}
