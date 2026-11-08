import { subtitleSnapshotFields } from "#infrastructure/publication-proof/subtitle-fields.ts";
import { Prisma, type SubtitleAsset } from "#generated/prisma/client.ts";
import {
  NativeSubtitleSnapshotSchema,
  type NativeSubtitleSnapshot,
} from "#shared/native-subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Caller holds selected asset rows after media/runtime locks, fencing new FK participants. */
export async function lockNativeSubtitleRows(
  tx: Prisma.TransactionClient,
  assetIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(assetIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
}

export function nativeSubtitleSnapshot(
  row: SubtitleAsset,
): NativeSubtitleSnapshot {
  return NativeSubtitleSnapshotSchema.parse({
    ...subtitleSnapshotFields(row),
  });
}

/** Staged/failed/purged rows never participate or become installed through rebaseline. */
export async function snapshotNativeSubtitles(
  tx: Prisma.TransactionClient,
  assetId: string,
): Promise<NativeSubtitleSnapshot[]> {
  const rows = await tx.subtitleAsset.findMany({
    where: { assetId, state: "installed" },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Native subtitle participant bound exceeded");
  const snapshots = rows.map((row) => nativeSubtitleSnapshot(row));
  await assertSubtitleCollisions(tx, snapshots);
  return snapshots;
}

export async function assertNativeSubtitleSnapshot(
  tx: Prisma.TransactionClient,
  assetId: string,
  expected: readonly NativeSubtitleSnapshot[],
): Promise<void> {
  const current = await snapshotNativeSubtitles(tx, assetId);
  if (
    snapshotHash(current) !==
    snapshotHash([...expected].sort((a, b) => a.id.localeCompare(b.id)))
  )
    throw new Error("Native subtitle snapshot changed after review");
}

async function assertSubtitleCollisions(
  tx: Prisma.TransactionClient,
  snapshots: NativeSubtitleSnapshot[],
): Promise<void> {
  for (const subtitle of snapshots) {
    const where =
      subtitle.storageKind === "sidecar"
        ? { path: subtitle.path }
        : {
            assetId: subtitle.assetId,
            storageKind: "embedded",
            streamIndex: subtitle.streamIndex,
          };
    if (
      (await tx.subtitleAsset.count({
        where: { ...where, id: { not: subtitle.id }, state: { not: "purged" } },
      })) > 0
    )
      throw new Error("Native subtitle storage collision requires review");
  }
}
