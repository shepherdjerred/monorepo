import { NativeRecoveryFileEvidenceSchema } from "#shared/native-recovery.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  NativeArchiveContinuation,
  NativeArchiveFile,
} from "#shared/native-recovery/archive.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Literal receipt projection shared by fresh and historical effective-scope validation. */
export function effectiveGrant(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<object>,
  descriptor: NativeArchiveContinuation,
  file: NativeArchiveFile,
) {
  let reference = descriptor.reusedBindings.find(
    (row) => row.assetId === file.assetId,
  );
  const binding = descriptor.bindings.find(
    (row) => row.assetId === file.assetId,
  );
  let current = file;
  if (binding !== undefined) {
    if (reference !== undefined)
      throw new Error("Archive grant and reuse overlap");
    current = {
      ...file,
      assetVersion: binding.assetVersion,
      ownershipEpoch: binding.ownershipEpoch,
      subtitles: file.subtitles.map((subtitle) => {
        const transition = binding.subtitles.find(
          (item) => item.id === subtitle.id,
        );
        if (transition === undefined)
          throw new Error("Archive subtitle transition missing");
        return { ...subtitle, ...transition.after };
      }),
    };
    const proof = descriptor.fileEvidence.files.find(
      (item) => item.assetId === file.assetId,
    );
    if (proof === undefined) throw new Error("Archive physical proof missing");
    reference = {
      kind: "prior_native_binding",
      receiptLifecycle: "superseded_archive",
      receiptId: receipt.id,
      planHash: receipt.planHash,
      assetId: file.assetId,
      bindingHash: snapshotHash(binding),
      physicalEvidenceHash: snapshotHash(nativePhysicalIdentity(proof)),
    };
  }
  if (reference === undefined)
    throw new Error("Archive continuation participant lacks effective binding");
  return { reference, current };
}

/** Explicit physical identity projection; old receipt JSON is never rewritten. */
export function nativePhysicalIdentity(raw: unknown) {
  const file = NativeRecoveryFileEvidenceSchema.shape.files.element.parse(raw);
  return {
    assetId: file.assetId,
    canonicalPath: file.canonicalPath,
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    identity: file.identity,
    subtitles: file.subtitles
      .map((subtitle) => ({
        id: subtitle.id,
        assetId: subtitle.assetId,
        videoChecksum: subtitle.videoChecksum,
        canonicalPath: subtitle.canonicalPath,
        checksum: subtitle.checksum,
        sizeBytes: subtitle.sizeBytes,
        identity: subtitle.identity,
        storageKind: subtitle.storageKind,
        qualityStatus: subtitle.qualityStatus,
        stream: subtitle.stream,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
