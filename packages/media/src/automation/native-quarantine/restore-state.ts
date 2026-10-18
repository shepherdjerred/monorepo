import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeQuarantineRestorationSchema,
  type NativeQuarantineContinuation,
} from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { snapshotNativeSubtitles } from "#automation/native-subtitles/snapshot.ts";
import { snapshotQuarantinedSubtitles } from "./subtitles.ts";

export async function assertQuarantineRestoreRows(
  tx: Prisma.TransactionClient,
  descriptor: NativeQuarantineContinuation,
  state: "quarantined" | "published",
  restoration?: unknown,
) {
  const receipt =
    state === "published"
      ? NativeQuarantineRestorationSchema.parse(restoration)
      : null;
  for (const binding of descriptor.bindings) {
    const file = descriptor.files.find(
      (item) => item.assetId === binding.assetId,
    );
    if (file === undefined)
      throw new Error("Quarantine restore binding omitted reviewed file");
    await assertDefaultPhysicalAsset(tx, binding.assetId);
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: binding.assetId },
      include: {
        coverage: { where: { current: true }, orderBy: { mediaId: "asc" } },
      },
    });
    const version =
      state === "published" ? binding.assetVersion + 1 : binding.assetVersion;
    if (
      !asset.owned ||
      asset.state !== state ||
      asset.version !== version ||
      asset.ownershipEpoch !== binding.ownershipEpoch ||
      asset.path !== file.canonicalPath ||
      asset.checksum !== binding.checksum ||
      asset.sizeBytes.toString() !== file.sizeBytes ||
      snapshotHash(asset.coverage.map((row) => row.mediaId)) !==
        snapshotHash([...binding.mediaIds].sort())
    )
      throw new Error("Quarantine restore asset or coverage changed");
    if (
      receipt !== null &&
      !receipt.assets.some(
        (item) =>
          item.assetId === asset.id &&
          item.assetVersion === version &&
          item.checksum === asset.checksum,
      )
    )
      throw new Error("Quarantine restored asset receipt changed");
    const current =
      state === "published"
        ? await snapshotNativeSubtitles(tx, asset.id)
        : await snapshotQuarantinedSubtitles(tx, asset.id);
    const expected = file.subtitles.map((subtitle) => {
      const subBinding = binding.subtitles.find(
        (item) => item.id === subtitle.id,
      );
      if (subBinding === undefined)
        throw new Error("Quarantine subtitle receipt binding missing");
      return {
        ...subtitle,
        ownershipEpoch: binding.ownershipEpoch,
        version: subBinding.version + (state === "published" ? 1 : 0),
        videoVersion: version,
        state: state === "published" ? "installed" : "quarantined",
      };
    });
    if (snapshotHash(current) !== snapshotHash(expected))
      throw new Error(
        "Quarantine restore subtitle identity, quality or provenance changed",
      );
  }
}

export async function writeNativeRestoreOperationReceipt(
  tx: Prisma.TransactionClient,
  operationId: string,
  receipt: unknown,
) {
  const restoreReceipt = NativeQuarantineRestorationSchema.parse(receipt);
  await tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ restoreReceipt })}::jsonb WHERE id = ${operationId}`;
}
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
