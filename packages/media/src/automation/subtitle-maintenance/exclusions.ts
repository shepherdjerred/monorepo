import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { SubtitleSearch } from "#domain/subtitle-maintenance/provider.ts";
import { subtitleScoreReferenceHashV1 } from "#domain/subtitle-maintenance/score.ts";
import { IntegrationError } from "#integrations/http.ts";

/** Only a known rejected download bound to this exact measured video and score
 * reference advances provider traversal. Unknown outcomes are never erased. */
export async function subtitleSearchExclusionsV1(
  context: MediaAutomationContext,
  input: SubtitleSearch,
): Promise<SubtitleSearch> {
  if (input.assetIdV1 === undefined || input.scoreReferenceV1 === undefined)
    return input;
  const asset = await context.db.libraryAsset.findUniqueOrThrow({
    where: { id: input.assetIdV1 },
  });
  if (!asset.owned || asset.checksum === null || asset.state !== "published")
    throw new IntegrationError("subtitles", "conflict");
  const referenceHash = subtitleScoreReferenceHashV1(input.scoreReferenceV1);
  const rejected = await context.db.subtitleAsset.findMany({
    where: {
      assetId: asset.id,
      videoVersion: asset.version,
      videoChecksum: asset.checksum,
      ownershipEpoch: asset.ownershipEpoch,
      language: input.language,
      qualityStatus: "rejected",
      matchingEvidence: {
        path: ["matchScoreV1", "referenceHash"],
        equals: referenceHash,
      },
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rejected.length > 100)
    throw new IntegrationError("subtitles", "interaction-required");
  const operationIds = rejected.flatMap((row) => {
    const evidence = z
      .object({ operationId: z.uuid().optional() })
      .parse(row.matchingEvidence);
    return evidence.operationId === undefined ? [] : [evidence.operationId];
  });
  const operations = await context.db.operation.findMany({
    where: {
      id: { in: operationIds },
      targetId: asset.id,
      kind: { in: ["acquire_subtitles", "acquire_movie_subtitles_v4"] },
    },
    take: 100,
  });
  const candidates = operations.map(
    (operation) =>
      z
        .object({
          subtitleDownload: z.object({
            providerId: z.string().min(1),
            candidateId: z.string().min(1),
          }),
        })
        .parse(operation.result).subtitleDownload,
  );
  return {
    ...input,
    excludedChecksumsV1: [
      ...new Set([
        ...(input.excludedChecksumsV1 ?? []),
        ...rejected.flatMap((row) =>
          row.checksum === null ? [] : [row.checksum],
        ),
      ]),
    ],
    excludedCandidatesV1: [
      ...(input.excludedCandidatesV1 ?? []),
      ...candidates.map(({ providerId, candidateId }) => ({
        providerId,
        candidateId,
      })),
    ],
  };
}
