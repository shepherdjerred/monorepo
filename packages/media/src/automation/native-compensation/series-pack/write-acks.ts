import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PublicationAssetSnapshot,
  PublicationParticipant,
} from "#shared/publication-proof/intent.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { seriesPackWriteSnapshotV1 } from "#automation/files/series-pack/publication/write-snapshots.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";
import path from "node:path";

/** Exact unchanged before-inventory was compared under all held locks by SQL055.
 * Only genuine write acknowledgements enter the after-image. Coverage and
 * untouched history come from paid immutable preparation parents, independently
 * compared by the same transaction's final SQL closure, never from a new query.
 */
export async function writeSeriesPackNativeBindingsV1(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  scope: SeriesPackNativeCompensationScopeV3,
) {
  const bindings = [];
  const retained: PublicationParticipant[] = [];
  for (const item of scope.publication.intent.entries) {
    const before = item.predecessor;
    if (
      before?.state !== "published" ||
      before.subtitles.some((row) => row.state !== "installed")
    )
      throw new Error(
        "Native pack before-image is not the original published physical group",
      );
    const actualAssetRows = await tx.libraryAsset.updateManyAndReturn({
      where: {
        id: before.id,
        version: before.version,
        owned: true,
        ownershipEpoch: before.ownershipEpoch,
        state: "published",
        checksum: before.checksum,
        path: before.path,
      },
      data: {
        version: { increment: 1 },
        ownershipEpoch: scope.request.recoveryEpoch,
      },
    });
    const asset = actualAssetRows[0];
    if (asset === undefined || actualAssetRows.length !== 1)
      throw new Error("Native pack whole predecessor CAS changed");
    const subtitles = [];
    for (const subtitle of before.subtitles) {
      const changed = await tx.subtitleAsset.updateManyAndReturn({
        where: {
          id: subtitle.id,
          assetId: before.id,
          version: subtitle.version,
          ownershipEpoch: subtitle.ownershipEpoch,
          state: "installed",
          videoChecksum: subtitle.videoChecksum,
          videoVersion: subtitle.videoVersion,
          path: subtitle.path,
          checksum: subtitle.checksum,
        },
        data: {
          ownershipEpoch: scope.request.recoveryEpoch,
          version: { increment: 1 },
          videoVersion: asset.version,
        },
      });
      if (changed.length !== 1 || changed[0] === undefined)
        throw new Error("Native pack whole caption CAS changed");
      subtitles.push(publicationSubtitleSnapshot(changed[0]));
    }
    const after = seriesPackWriteSnapshotV1(asset, {
      coverage: before.coverage,
      subtitles: subtitles.sort((a, b) => a.id.localeCompare(b.id)),
      subtitleHistory: before.subtitleHistory,
    });
    const observed = await observePublicationParticipants(context, item.entry);
    const participants = observed.filter(
      (row) =>
        row.physical.root === "library" &&
        (row.role === "video" || row.role === "sidecar"),
    );
    assertSeriesPackNativeRestoredV1(context, before, participants);
    bindings.push({ before, after, participants });
    retained.push(...observed.filter((row) => row.physical.root === "control"));
  }
  return { bindings, retained };
}

/** The original stored path survives only when the actual configured mapping
 * independently resolves it to this exact protected physical destination.
 */
export function assertSeriesPackNativeRestoredV1(
  context: PublicationContext,
  before: PublicationAssetSnapshot,
  participants: readonly PublicationParticipant[],
) {
  const sidecars = before.subtitles.filter(
    (row) => row.storageKind === "sidecar",
  );
  const assertParticipantSet1 = () => {
    if (
      participants.length !== sidecars.length + 1 ||
      new Set(participants.map((row) => row.subtitleId)).size !==
        participants.length
    )
      throw new Error("Native pack restored participant membership changed");
  };
  assertParticipantSet1();
  for (const participant of participants) {
    const subtitle =
      participant.subtitleId === null
        ? null
        : sidecars.find((row) => row.id === participant.subtitleId);
    const canonical = subtitle === null ? before.path : subtitle?.path;
    const checksum = subtitle === null ? before.checksum : subtitle?.checksum;
    const physical = participant.physical;
    if (
      canonical == null ||
      checksum == null ||
      participant.assetId !== before.id ||
      participant.libraryKind !== "tv" ||
      physical.root !== "library" ||
      participant.role !== (subtitle === null ? "video" : "sidecar") ||
      physical.state !== "present" ||
      physical.sha256 !== checksum ||
      (subtitle === null && physical.sizeBytes !== before.sizeBytes) ||
      workerFilePath(context, canonical) !==
        path.join(context.roots.tv.library, physical.path)
    )
      throw new Error(
        "Native pack compensation did not restore its exact original bytes and stored path",
      );
  }
}
