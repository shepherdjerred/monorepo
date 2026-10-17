import type { LibraryAsset, SubtitleAsset } from "#generated/prisma/client.ts";
import { FileGuardError, type Transaction } from "#automation/files/types.ts";

/** Every tracked installed subtitle is checked; unowned historical records protect the video. */
export function ownedSubtitleSidecars(
  asset: Pick<LibraryAsset, "checksum" | "version" | "ownershipEpoch"> & {
    subtitles: SubtitleAsset[];
  },
) {
  for (const subtitle of asset.subtitles) {
    if (
      subtitle.ownershipEpoch !== asset.ownershipEpoch ||
      subtitle.ownershipEpoch < 0 ||
      subtitle.videoChecksum !== asset.checksum ||
      subtitle.videoVersion !== asset.version ||
      !["sidecar", "embedded"].includes(subtitle.storageKind) ||
      (subtitle.storageKind === "sidecar" &&
        (subtitle.path === null || subtitle.checksum === null)) ||
      (subtitle.storageKind === "embedded" &&
        (subtitle.streamIndex === null || subtitle.codec === null))
    )
      throw new FileGuardError("subtitle_ownership_unconfirmed");
  }
  return asset.subtitles.filter(
    (subtitle) => subtitle.storageKind === "sidecar",
  );
}

/** Called only after the corresponding verified video lifecycle effect, under its MediaItem locks. */
export async function advanceSubtitleBindings(
  tx: Transaction,
  input: {
    assetId: string;
    checksum: string;
    epoch: number;
    fromVersion: number;
    toVersion: number;
    fromState: "installed" | "quarantined" | "superseded";
    sidecarIds: string[];
    state: string;
  },
) {
  await tx.subtitleAsset.updateMany({
    where: {
      assetId: input.assetId,
      videoChecksum: input.checksum,
      ownershipEpoch: input.epoch,
      videoVersion: input.fromVersion,
      state: input.fromState,
      OR: [
        {
          storageKind: "sidecar",
          id: { in: input.sidecarIds },
          path: { not: null },
          checksum: { not: null },
        },
        {
          storageKind: "embedded",
          streamIndex: { not: null },
          codec: { not: null },
        },
      ],
    },
    data: {
      videoVersion: input.toVersion,
      state: input.state,
      version: { increment: 1 },
    },
  });
}
