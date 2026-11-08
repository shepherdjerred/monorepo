import type { Prisma } from "#generated/prisma/client.ts";
import type { HandoffProtocolScope } from "#shared/handoff/protocol.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";

/** Retain the actual initial owners, including caption rows, before later lifecycle changes. */
export async function initialLibrarySnapshots(
  tx: Prisma.TransactionClient,
  scope: HandoffProtocolScope,
  budget: PublicationAuthorityReadBudget,
) {
  if (!("schemaVersion" in scope)) return {};
  const assets = [];
  for (const file of scope.files) {
    const asset =
      file.libraryKind === "movies"
        ? await snapshotMoviePublicationAssetV2(
            tx,
            {
              rootMediaId: file.mediaIds[0] ?? "",
              mediaId: file.mediaIds[0] ?? "",
              edition: file.edition,
            },
            file.assetId,
            budget,
          )
        : await snapshotPublicationAsset(tx, file.assetId, budget);
    if (
      asset.ownershipEpoch !== scope.request.recoveryEpoch ||
      asset.version !== 0 ||
      asset.state !== "published" ||
      asset.path !== file.canonicalPath
    )
      throw new Error("Initial library owner snapshot changed");
    assets.push(asset);
  }
  return { schemaVersion: scope.schemaVersion, assets };
}
