import { createHash } from "node:crypto";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import {
  NativeArchiveSubtitleSnapshotSchema,
  type NativeArchiveFile,
} from "#shared/native-recovery/archive.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { snapshotHash } from "#migration/profile-import.ts";

function snapshot(row: SubtitleAsset) {
  return NativeArchiveSubtitleSnapshotSchema.parse({
    id: row.id,
    assetId: row.assetId,
    version: row.version,
    ownershipEpoch: row.ownershipEpoch,
    state: row.state,
    qualityStatus: row.qualityStatus,
    storageKind: row.storageKind,
    language: row.language,
    providerId: row.providerId,
    path: row.path,
    checksum: row.checksum,
    videoChecksum: row.videoChecksum,
    videoVersion: row.videoVersion,
    forced: row.forced,
    hearingImpaired: row.hearingImpaired,
    streamIndex: row.streamIndex,
    codec: row.codec,
    provenance: row.provenance,
    matchingEvidence: row.matchingEvidence,
    contentChecksum:
      row.content === null
        ? null
        : createHash("sha256").update(row.content).digest("hex"),
  });
}

/** Unknown/staged participants cannot become installed or superseded through archive recovery. */
export async function snapshotArchiveSubtitles(
  tx: Prisma.TransactionClient,
  assetId: string,
): Promise<NativeArchiveFile["subtitles"]> {
  const rows = await tx.subtitleAsset.findMany({
    where: { assetId, state: { not: "purged" }, AND: [videoSubtitleWhere] },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Archive subtitle participant bound exceeded");
  const result = rows.map((row) => snapshot(row));
  for (const subtitle of result) {
    const identity =
      subtitle.storageKind === "sidecar"
        ? { path: subtitle.path }
        : {
            assetId,
            storageKind: "embedded",
            streamIndex: subtitle.streamIndex,
          };
    if (
      (await tx.subtitleAsset.count({
        where: {
          ...identity,
          id: { not: subtitle.id },
          state: { not: "purged" },
          AND: [videoSubtitleWhere],
        },
      })) > 0
    )
      throw new Error("Archive subtitle physical identity collision");
  }
  return result;
}

export function assertArchiveSubtitleBindings(file: NativeArchiveFile): void {
  for (const subtitle of file.subtitles) {
    if (
      subtitle.assetId !== file.assetId ||
      subtitle.ownershipEpoch !== file.ownershipEpoch ||
      subtitle.videoChecksum !== file.checksum ||
      subtitle.videoVersion !== file.assetVersion ||
      subtitle.state !==
        (file.state === "published" ? "installed" : "superseded")
    )
      throw new Error(
        "Archive subtitle video ownership or lifecycle binding changed",
      );
    if (subtitle.storageKind === "sidecar") {
      if (
        subtitle.path === null ||
        subtitle.checksum === null ||
        subtitle.streamIndex !== null
      )
        throw new Error("Archive sidecar identity is incomplete");
    } else if (
      subtitle.path !== null ||
      subtitle.streamIndex === null ||
      subtitle.codec === null
    )
      throw new Error("Archive embedded identity is incomplete");
  }
}

export async function rebindArchiveSubtitles(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  epoch: number,
  newAssetVersion: number,
) {
  assertArchiveSubtitleBindings(file);
  if (epoch <= file.ownershipEpoch || newAssetVersion !== file.assetVersion + 1)
    throw new Error("Archive subtitle requires a real new-epoch binding");
  if (
    snapshotHash(await snapshotArchiveSubtitles(tx, file.assetId)) !==
    snapshotHash(file.subtitles)
  )
    throw new Error("Archive subtitle snapshot changed");
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: file.assetId },
  });
  if (
    !asset.owned ||
    asset.state !== file.state ||
    asset.version !== newAssetVersion ||
    asset.ownershipEpoch !== epoch ||
    asset.checksum !== file.checksum ||
    asset.path !== file.canonicalPath
  )
    throw new Error("Archive video was not rebound in this transaction");
  const bindings = [];
  for (const subtitle of file.subtitles) {
    const updated = await tx.subtitleAsset.updateMany({
      where: {
        id: subtitle.id,
        version: subtitle.version,
        state: subtitle.state,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
      },
      data: {
        ownershipEpoch: epoch,
        version: { increment: 1 },
        videoVersion: newAssetVersion,
      },
    });
    if (updated.count !== 1)
      throw new Error("Archive subtitle participant changed during renewal");
    bindings.push({
      id: subtitle.id,
      before: {
        version: subtitle.version,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
      },
      after: {
        version: subtitle.version + 1,
        ownershipEpoch: epoch,
        videoVersion: newAssetVersion,
      },
      qualityStatus: subtitle.qualityStatus,
    });
  }
  return bindings;
}
