import { createHash } from "node:crypto";
import type { SubtitleAsset } from "#generated/prisma/client.ts";

/** Scalar snapshot only; each protocol retains its own state schema and participant query. */
export function subtitleSnapshotFields(row: SubtitleAsset) {
  return {
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
  };
}
