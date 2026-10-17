import { Prisma } from "#generated/prisma/client.ts";
import { lockNativeSubtitleRows } from "#automation/native-subtitles/snapshot.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";

/** After full acquisition canonical/claim/runtime authority, before sorted path locks. */
export async function lockPublicationRows(
  tx: Prisma.TransactionClient,
  intent: {
    attemptId: string;
    mediaIds: readonly string[];
    entries: readonly {
      entry: { assetId: string; previousAssetId: string | null };
    }[];
  },
): Promise<void> {
  const assets = [
    ...new Set(
      intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: intent.mediaIds,
    assetIds: assets,
  });
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "UpgradeCleanup" WHERE "assetId" IN (${Prisma.join(assets)}) OR "successorAssetId" IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
  );
  await lockNativeSubtitleRows(tx, assets);
  await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${intent.attemptId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "MediaPublicationTransition" WHERE "attemptId"=${intent.attemptId} FOR UPDATE`;
}
