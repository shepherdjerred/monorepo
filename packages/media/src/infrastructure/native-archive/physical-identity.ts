import { NativeRecoveryFileEvidenceSchema } from "#shared/native-recovery.ts";

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
