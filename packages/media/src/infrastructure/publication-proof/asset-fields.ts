import type { LibraryAsset } from "#generated/prisma/client.ts";

type AssetIdentityFields<Properties> = Pick<
  LibraryAsset,
  | "id"
  | "version"
  | "edition"
  | "editionRootId"
  | "owned"
  | "ownershipEpoch"
  | "state"
  | "path"
  | "sourcePath"
  | "checksum"
  | "supersededByAssetId"
> & { sizeBytes: bigint | string; properties: Properties };

/** Shared video facts only; this projection grants no publication or rollback timestamps. */
export function publicationAssetIdentityFields<Properties>(
  asset: AssetIdentityFields<Properties>,
) {
  return {
    id: asset.id,
    version: asset.version,
    edition: asset.edition,
    editionRootId: asset.editionRootId,
    owned: asset.owned,
    ownershipEpoch: asset.ownershipEpoch,
    state: asset.state,
    path: asset.path,
    sourcePath: asset.sourcePath,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes.toString(),
    properties: asset.properties,
    supersededByAssetId: asset.supersededByAssetId,
  };
}

/** Scalar projection only; callers retain their own versioned schemas and paid inventories. */
export function publicationAssetFields(asset: LibraryAsset) {
  return {
    ...publicationAssetIdentityFields(asset),
    plexPublishedAt: asset.plexPublishedAt?.toISOString() ?? null,
    rollbackExpiresAt: asset.rollbackExpiresAt?.toISOString() ?? null,
  };
}
