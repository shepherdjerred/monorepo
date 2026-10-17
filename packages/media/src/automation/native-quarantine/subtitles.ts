import { createHash } from "node:crypto";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import {
  NativeQuarantineSubtitleSchema,
  type NativeQuarantineFile,
} from "#shared/native-recovery/quarantine.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { snapshotHash } from "#migration/profile-import.ts";

function snapshot(row: SubtitleAsset) {
  return NativeQuarantineSubtitleSchema.parse({
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

/** Only exact committed quarantine participants; independent receipt-owned archives stay separate. */
export async function snapshotQuarantinedSubtitles(
  tx: Prisma.TransactionClient,
  assetId: string,
): Promise<NativeQuarantineFile["subtitles"]> {
  const rows = await tx.subtitleAsset.findMany({
    where: { assetId, state: { not: "purged" }, AND: [videoSubtitleWhere] },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Quarantine subtitle participant bound exceeded");
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
      throw new Error("Quarantine subtitle physical identity collision");
  }
  return result;
}

/** Pure binding validation also used before any filesystem inspection. */
export function assertQuarantinedSubtitleBindings(
  file: NativeQuarantineFile,
): void {
  for (const subtitle of file.subtitles) {
    if (
      subtitle.assetId !== file.assetId ||
      subtitle.ownershipEpoch !== file.ownershipEpoch ||
      subtitle.videoChecksum !== file.checksum ||
      subtitle.videoVersion !== file.assetVersion
    )
      throw new Error(
        "Quarantined subtitle belongs to a different video version or ownership epoch",
      );
    const sidecar = file.sidecars.find(
      (item) => item.subtitleId === subtitle.id,
    );
    if (subtitle.storageKind === "sidecar") {
      if (
        sidecar?.checksum !== subtitle.checksum ||
        subtitle.path !== `/data/${file.libraryKind}/${sidecar.libraryPath}` ||
        subtitle.streamIndex !== null
      )
        throw new Error(
          "Quarantined sidecar manifest does not match stored participant",
        );
    } else if (
      sidecar !== undefined ||
      subtitle.path !== null ||
      subtitle.streamIndex === null ||
      subtitle.codec === null
    )
      throw new Error(
        "Quarantined embedded subtitle has contradictory storage identity",
      );
  }
  if (
    file.sidecars.length !==
    file.subtitles.filter((item) => item.storageKind === "sidecar").length
  )
    throw new Error("Quarantined sidecar manifest coverage is incomplete");
}

/** Physical rebaseline changes neither quality/provenance nor quarantine state. */
export async function rebindQuarantinedSubtitles(
  tx: Prisma.TransactionClient,
  file: NativeQuarantineFile,
  epoch: number,
  newAssetVersion: number,
) {
  assertQuarantinedSubtitleBindings(file);
  if (epoch <= file.ownershipEpoch || newAssetVersion !== file.assetVersion + 1)
    throw new Error(
      "Quarantined subtitle renewal requires a later restore epoch",
    );
  if (
    snapshotHash(await snapshotQuarantinedSubtitles(tx, file.assetId)) !==
    snapshotHash(file.subtitles)
  )
    throw new Error("Quarantined subtitle snapshot changed");
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: file.assetId },
  });
  if (
    !asset.owned ||
    asset.state !== "quarantined" ||
    asset.version !== newAssetVersion ||
    asset.ownershipEpoch !== epoch ||
    asset.checksum !== file.checksum ||
    asset.path !== file.canonicalPath
  )
    throw new Error(
      "Quarantined video authority was not rebound in this transaction",
    );
  const bindings = [];
  for (const subtitle of file.subtitles) {
    const updated = await tx.subtitleAsset.updateMany({
      where: {
        id: subtitle.id,
        version: subtitle.version,
        state: "quarantined",
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
      throw new Error(
        "Quarantined subtitle participant changed during renewal",
      );
    bindings.push({
      id: subtitle.id,
      version: subtitle.version + 1,
      videoVersion: newAssetVersion,
      checksum: subtitle.checksum,
      storageKind: subtitle.storageKind,
    });
  }
  return bindings;
}
