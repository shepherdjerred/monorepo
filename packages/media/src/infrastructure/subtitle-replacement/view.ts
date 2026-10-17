import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  SubtitleReplacementSnapshotSchema,
  SubtitleReplacementDetailSchema,
} from "#shared/subtitle-replacement.ts";

export function replacementDetail(
  row: Prisma.SubtitleReplacementGetPayload<{
    include: { review: true; receipt: true };
  }>,
) {
  const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
  return SubtitleReplacementDetailSchema.parse({
    id: row.id,
    version: row.version,
    state: row.state,
    reason: row.reason,
    titles: scope.asset.coverage.map((item) => ({
      mediaId: item.mediaId,
      title: item.title,
    })),
    language: scope.candidate.language,
    forced: scope.candidate.forced,
    hearingImpaired: scope.candidate.hearingImpaired,
    oldQuality: scope.old.qualityStatus,
    newQuality: scope.candidate.qualityStatus,
    oldProvider: scope.old.providerId,
    newProvider: scope.candidate.providerId,
    destinationName: path.basename(scope.destination),
    observationHash: row.review?.observationHash ?? null,
    reviewExpiresAt: row.review?.expiresAt.toISOString() ?? null,
    archiveExpiresAt: row.archiveExpiresAt?.toISOString() ?? null,
    cleanupState: row.cleanupState,
    cleanupReason: row.cleanupReason,
    reservationActive: row.reservationActive,
    receiptOutcome: row.receipt?.outcome ?? null,
  });
}
