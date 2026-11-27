import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import type { ReleaseEvaluation } from "./release-evaluation.ts";
import {
  ResolvedEvidenceProtocolSchema,
  evidenceMatcher,
} from "./resolved-evidence.ts";
import { evaluateResolvedRelease } from "./resolved-quality.ts";
import { chooseResolvedUpgrade } from "./resolved-upgrade.ts";
import { VERIFIED_SOURCE_COMMITS } from "./resolved-contract.ts";
import {
  isProgressiveQualityProfile,
  progressiveFallbackDistance,
  progressiveSizeCeiling,
  progressivePictureRank,
  progressiveUpgrade,
  compareLegacyMeasuredPredecessor,
} from "./progressive-quality.ts";

function evidenceFor(release: ReleaseAttributes, profile: QualityProfile) {
  const evidence =
    release.resolvedEvidence === undefined
      ? null
      : ResolvedEvidenceProtocolSchema.parse(release.resolvedEvidence);
  if (
    evidence === null ||
    evidence.source !== profile.resolved?.source ||
    evidence.sourceVersion !== profile.resolved.sourceVersion
  )
    return null;
  const source = profile.resolved;
  if (
    VERIFIED_SOURCE_COMMITS[`${source.source}:${source.sourceVersion}`] !==
    source.sourceCommit
  )
    return null;
  return {
    ...evidence,
    release: {
      ...evidence.release,
      id: release.id,
      identityConfirmed:
        release.identityConfidence === "exact" &&
        evidence.release.identityConfirmed,
      sizeBytes: release.sizeBytes,
    },
  };
}
function coverageReasons(
  release: ReleaseAttributes,
  mediaIds: readonly string[],
): string[] {
  return mediaIds.length === 0
    ? ["coverage_unspecified"]
    : mediaIds.some((id) => !release.mediaIds.includes(id))
      ? ["incomplete_coverage"]
      : [];
}
export function evaluateResolvedPolicy(
  release: ReleaseAttributes,
  profile: QualityProfile,
  mediaIds: readonly string[],
  phase: "listing" | "measured" = "measured",
): ReleaseEvaluation {
  const evidence = evidenceFor(release, profile);
  if (evidence === null || profile.resolved === undefined)
    return {
      accepted: false,
      reasons: ["resolved_evidence_missing"],
      score: 0,
      qualityRank: -1,
    };
  const progressive = isProgressiveQualityProfile(profile);
  const result = evaluateResolvedRelease(
    profile.resolved,
    evidence.release,
    evidenceMatcher([evidence]),
    progressive ? { progressivePhase: phase } : phase,
  );
  // Listing bytes cover every mapped leaf. Measured bytes cover the physical file.
  const fileCount = phase === "listing" ? new Set(release.mediaIds).size : 1;
  const hardCeiling = progressive
    ? progressiveSizeCeiling(profile, fileCount)
    : null;
  const reasons = [
    ...evidence.protectedReasons,
    ...coverageReasons(release, mediaIds),
    ...result.reasons,
    ...(phase === "listing" ||
    profile.resolved.householdPolicy === undefined ||
    release.videoCompatibility === "compatible"
      ? []
      : [
          release.videoCompatibility === "incompatible"
            ? "incompatible_dynamic_range"
            : "video_compatibility_unknown",
        ]),
    ...(hardCeiling !== null && release.sizeBytes > hardCeiling
      ? ["size_hard_ceiling_exceeded"]
      : []),
  ];
  const distance =
    hardCeiling === null
      ? undefined
      : progressiveFallbackDistance(
          profile,
          evidence.release,
          reasons,
          hardCeiling,
        );
  return {
    accepted:
      (result.status === "accepted" && reasons.length === 0) ||
      distance !== undefined,
    reasons: reasons.map((reason) => `resolved_${reason}`),
    score: result.score,
    qualityRank:
      distance === undefined
        ? result.qualityRank
        : (progressivePictureRank(profile, evidence.release.qualityId) ??
          result.qualityRank),
    ...(distance === undefined ? {} : { fallbackDistanceBytes: distance }),
  };
}
export function chooseResolvedPolicy(input: {
  candidate: ReleaseAttributes;
  current: ReleaseAttributes | null;
  profile: QualityProfile;
  mediaIds: readonly string[];
  phase?: "listing" | "measured";
}) {
  const evaluation = evaluateResolvedPolicy(
    input.candidate,
    input.profile,
    input.mediaIds,
    input.phase,
  );
  const candidate = evidenceFor(input.candidate, input.profile);
  if (
    candidate === null ||
    input.profile.resolved === undefined ||
    !evaluation.accepted
  )
    return {
      upgrade: false,
      reason: "candidate_protected_or_rejected",
      evaluation,
    };
  const current =
    input.current === null
      ? null
      : verifiedCurrent(input.current, input.profile);
  if (current === null && input.current !== null) {
    const reason = compareLegacyMeasuredPredecessor({
      profile: input.profile,
      current: input.current,
      next: candidate.release,
      evaluation,
      mediaIds: input.mediaIds,
    });
    return {
      upgrade: reason === "quality_upgrade" || reason === "fallback_upgrade",
      reason,
      evaluation,
    };
  }
  if (current === null && evaluation.fallbackDistanceBytes !== undefined)
    return { upgrade: true, reason: "initial_fallback", evaluation };
  if (
    current !== null &&
    input.current !== null &&
    isProgressiveQualityProfile(input.profile)
  ) {
    if (current.release.id === candidate.release.id)
      return { upgrade: false, reason: "same_release", evaluation };
    const reason = progressiveUpgrade(
      input.profile,
      { release: candidate.release, evaluation },
      {
        release: current.release,
        evaluation: evaluateResolvedPolicy(
          input.current,
          input.profile,
          input.mediaIds,
        ),
      },
    );
    if (reason !== null)
      return { upgrade: reason === "fallback_upgrade", reason, evaluation };
  }
  const decision = chooseResolvedUpgrade({
    profile: input.profile.resolved,
    candidate: candidate.release,
    current: current?.release ?? null,
    matcher: evidenceMatcher(
      current === null ? [candidate] : [candidate, current],
    ),
    phase: input.phase,
  });
  return { upgrade: decision.upgrade, reason: decision.reason, evaluation };
}

function verifiedCurrent(release: ReleaseAttributes, profile: QualityProfile) {
  const evidence = evidenceFor(release, profile);
  if (evidence === null || evidence.protectedReasons.length > 0) return null;
  return profile.resolved?.householdPolicy === undefined ||
    release.videoCompatibility === "compatible"
    ? evidence
    : null;
}
