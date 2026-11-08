import type { Prisma } from "#generated/prisma/client.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type {
  NativeSubtitleEvidence,
  NativeSubtitleSnapshot,
} from "#shared/native-subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertNativeSubtitleSnapshot } from "./snapshot.ts";
import {
  assertNativeSubtitleNeighbors,
  type NativeSubtitleFile,
  type NativeSubtitlePathResolver,
  nativeSubtitleLocalPath,
} from "./proof.ts";

/** Caller holds PG authority/asset/subtitle rows then sorted video+sidecar FS locks.
 * content is fresh process-local proof, never reconstructed from review JSON. */
export async function rebindNativeSubtitles(
  tx: Prisma.TransactionClient,
  input: {
    file: NativeSubtitleFile;
    evidence: NativeSubtitleEvidence[];
    content: ContentProof;
    newAssetVersion: number;
    epoch: number;
    resolvePath?: NativeSubtitlePathResolver;
  },
) {
  const { file } = input;
  if (
    input.epoch <= file.ownershipEpoch ||
    input.newAssetVersion !== file.assetVersion + 1
  )
    throw new Error(
      "Native subtitle renewal needs an explicit later restore epoch",
    );
  await assertNativeSubtitleSnapshot(tx, file.assetId, file.subtitles);
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: file.assetId },
  });
  if (
    asset.path !== file.canonicalPath ||
    asset.checksum !== file.checksum ||
    asset.version !== input.newAssetVersion ||
    asset.ownershipEpoch !== input.epoch ||
    asset.state !== "published" ||
    !asset.owned
  )
    throw new Error(
      "Native subtitle video renewal is not committed in this transaction",
    );
  if (
    (await input.content.digest(
      nativeSubtitleLocalPath(file.canonicalPath, input.resolvePath),
    )) !== file.checksum
  )
    throw new Error("Native subtitle video proof changed");
  await assertNativeSubtitleNeighbors(file, input.resolvePath);
  if (
    input.evidence.length !== file.subtitles.length ||
    new Set(input.evidence.map((item) => item.id)).size !==
      file.subtitles.length
  )
    throw new Error("Native subtitle evidence coverage changed");
  const bindings = [];
  for (const subtitle of file.subtitles) {
    if (subtitle.ownershipEpoch !== file.ownershipEpoch)
      throw new Error(
        "Native subtitle prior ownership epoch disagrees with video",
      );
    await assertParticipantEvidence(
      subtitle,
      file,
      input.evidence.find((item) => item.id === subtitle.id),
      input,
    );
    const updated = await tx.subtitleAsset.updateMany({
      where: {
        id: subtitle.id,
        version: subtitle.version,
        state: "installed",
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
        videoChecksum: subtitle.videoChecksum,
      },
      data: {
        ownershipEpoch: input.epoch,
        version: { increment: 1 },
        videoVersion: input.newAssetVersion,
      },
    });
    if (updated.count !== 1)
      throw new Error("Native subtitle participant changed during renewal");
    bindings.push({
      id: subtitle.id,
      before: {
        version: subtitle.version,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
      },
      after: {
        version: subtitle.version + 1,
        ownershipEpoch: input.epoch,
        videoVersion: input.newAssetVersion,
      },
      qualityStatus: subtitle.qualityStatus,
    });
  }
  return bindings;
}

async function assertParticipantEvidence(
  subtitle: NativeSubtitleSnapshot,
  file: NativeSubtitleFile,
  evidence: NativeSubtitleEvidence | undefined,
  input: { content: ContentProof; resolvePath?: NativeSubtitlePathResolver },
): Promise<void> {
  const { content, resolvePath } = input;
  if (
    evidence?.snapshotHash !== snapshotHash(subtitle) ||
    evidence.videoChecksum !== file.checksum ||
    evidence.assetId !== file.assetId ||
    evidence.qualityStatus !== subtitle.qualityStatus ||
    evidence.storageKind !== subtitle.storageKind ||
    evidence.canonicalPath !== subtitle.path ||
    evidence.checksum !== subtitle.checksum
  )
    throw new Error(
      "Native subtitle evidence disagrees with reviewed participant",
    );
  if (
    subtitle.path !== null &&
    ((await content.digest(
      nativeSubtitleLocalPath(subtitle.path, resolvePath),
    )) !== subtitle.checksum ||
      snapshotHash(
        await content.reviewIdentity(
          nativeSubtitleLocalPath(subtitle.path, resolvePath),
        ),
      ) !== snapshotHash(evidence.identity))
  )
    throw new Error("Native subtitle sidecar identity changed");
  if (
    subtitle.storageKind === "embedded" &&
    (evidence.stream?.index !== subtitle.streamIndex ||
      evidence.stream.codec !== subtitle.codec)
  )
    throw new Error("Native subtitle embedded proof missing");
}
