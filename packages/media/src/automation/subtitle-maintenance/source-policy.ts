import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import type {
  SubtitleSource,
  SubtitleSearch,
} from "#domain/subtitle-maintenance/provider.ts";
import {
  subtitleSourceScoreV1,
  subtitleScoreReferenceHashV1,
} from "#domain/subtitle-maintenance/score.ts";
import {
  subtitleScorePercent,
  SubtitleMatchScoreV1Schema,
  type SubtitleMatchScoreV1,
} from "#shared/subtitle-maintenance/score.ts";

/** Keep optional historical source contracts usable; every new reference-bound
 * search carries verifiable numerical matching evidence. */
export function scoredSubtitleSourceV1(
  source: SubtitleSource,
  search: SubtitleSearch,
) {
  return search.scoreReferenceV1 === undefined
    ? source
    : {
        ...source,
        matchScoreV1: subtitleSourceScoreV1(search.scoreReferenceV1, source),
      };
}

type ScoredSearch = Pick<
  SubtitleSearch,
  "language" | "scoreReferenceV1" | "upgradeV1" | "excludedChecksumsV1"
>;
function scoreRejection(
  score: SubtitleMatchScoreV1 | null,
  search: ScoredSearch,
): string | null {
  if (score?.catalogStatus === "conflict")
    return "subtitle_canonical_identity_conflict";
  if (score === null && search.scoreReferenceV1 !== undefined)
    return "subtitle_score_evidence_unknown";
  if (
    score !== null &&
    search.scoreReferenceV1 !== undefined &&
    (score.kind !== search.scoreReferenceV1.kind ||
      score.referenceHash !==
        subtitleScoreReferenceHashV1(search.scoreReferenceV1))
  )
    return "subtitle_score_reference_changed";
  if (
    score !== null &&
    subtitleScorePercent(score) < (score.kind === "episode" ? 70 : 80)
  )
    return "subtitle_score_below_minimum";
  if (search.upgradeV1 !== undefined) {
    const previous = search.upgradeV1.minimumScore;
    if (
      score?.kind !== previous.kind ||
      score.referenceHash !== previous.referenceHash
    )
      return "subtitle_score_reference_changed";
    else if (score.score <= previous.score)
      return "subtitle_score_not_improved";
  }
  return null;
}
export function subtitleSourceDecisionV1(
  source: SubtitleSource,
  search: ScoredSearch,
) {
  const validated = validateSubtitle({
    bytes: source.bytes,
    filename: source.filename,
    provenanceText: source.description,
    requireSimplified: ["zh-Hans", "zh-CN"].includes(search.language),
    ...(source.declaredEncoding === undefined
      ? {}
      : { declaredEncoding: source.declaredEncoding }),
  });
  const checksum = createHash("sha256").update(validated.text).digest("hex");
  const score =
    source.matchScoreV1 === undefined
      ? null
      : SubtitleMatchScoreV1Schema.parse(source.matchScoreV1);
  const reason =
    search.excludedChecksumsV1?.includes(checksum) === true
      ? "subtitle_checksum_rejected_or_current"
      : scoreRejection(score, search);
  const definitive =
    reason !== null &&
    ![
      "subtitle_score_reference_changed",
      "subtitle_score_evidence_unknown",
    ].includes(reason);
  return { accepted: reason === null, definitive, reason, checksum, score };
}

/** A definitive rejected result is history, not permission to replay a download.
 * The next operation uses a new durable key and excludes this exact digest. */
export function recordSubtitleSourceRejectionV1(
  tx: Prisma.TransactionClient,
  input: {
    asset: { id: string; version: number; checksum: string | null };
    epoch: number;
    providerId: string;
    language: string;
    operationId: string;
    source: SubtitleSource;
    decision: ReturnType<typeof subtitleSourceDecisionV1>;
  },
) {
  if (input.decision.accepted || input.decision.reason === null)
    throw new Error("Only a definitive rejected candidate can be recorded");
  return tx.subtitleAsset.create({
    data: {
      assetId: input.asset.id,
      providerId: input.providerId,
      language: input.language,
      state: input.decision.definitive ? "rejected" : "protected",
      qualityStatus: input.decision.definitive ? "rejected" : "unverified",
      storageKind: "sidecar",
      ownershipEpoch: input.epoch,
      checksum: input.decision.checksum,
      videoChecksum: input.asset.checksum,
      videoVersion: input.asset.version,
      forced: input.source.forced,
      hearingImpaired: input.source.hearingImpaired,
      provenance: {
        filename: input.source.filename,
        source: "subtitle-maintenance-v1",
      },
      matchingEvidence: z.record(z.string(), z.json()).parse({
        operationId: input.operationId,
        reason: input.decision.reason,
        matchScoreV1: input.decision.score,
      }),
    },
  });
}
