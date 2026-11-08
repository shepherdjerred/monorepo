import type { LibraryAsset } from "#generated/prisma/client.ts";
import { PublicationAssetSnapshotSchema } from "#shared/publication-proof/intent.ts";
import { publicationAssetFields } from "#infrastructure/publication-proof/asset-fields.ts";

/** Only actual write acknowledgements and unchanged rows from paid, SQL-fenced parents enter this projection. */
export function seriesPackWriteSnapshotV1(
  asset: LibraryAsset,
  rows: { coverage: unknown; subtitles: unknown; subtitleHistory: unknown },
) {
  return PublicationAssetSnapshotSchema.parse({
    ...publicationAssetFields(asset),
    ...rows,
  });
}
