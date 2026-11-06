import type { LibraryAsset } from "#generated/prisma/client.ts";
import { PublicationAssetSnapshotSchema } from "#shared/publication-proof/intent.ts";

/** Only actual write acknowledgements and unchanged rows from paid, SQL-fenced parents enter this projection. */
export function seriesPackWriteSnapshotV1(
  asset: LibraryAsset,
  rows: { coverage: unknown; subtitles: unknown; subtitleHistory: unknown },
) {
  return PublicationAssetSnapshotSchema.parse({
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
    plexPublishedAt: asset.plexPublishedAt?.toISOString() ?? null,
    rollbackExpiresAt: asset.rollbackExpiresAt?.toISOString() ?? null,
    ...rows,
  });
}
