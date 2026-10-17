import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import type { ReleaseEvaluation } from "./release-evaluation.ts";
import {
  ResolvedEvidenceSchema,
  evidenceMatcher,
} from "./resolved-evidence.ts";
import { evaluateResolvedRelease } from "./resolved-quality.ts";
import { chooseResolvedUpgrade } from "./resolved-upgrade.ts";
import { VERIFIED_SOURCE_COMMITS } from "./resolved-contract.ts";

function evidenceFor(release: ReleaseAttributes, profile: QualityProfile) {
  const evidence =
    release.resolvedEvidence === undefined
      ? null
      : ResolvedEvidenceSchema.parse(release.resolvedEvidence);
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
): ReleaseEvaluation {
  const evidence = evidenceFor(release, profile);
  if (evidence === null || profile.resolved === undefined)
    return {
      accepted: false,
      reasons: ["resolved_evidence_missing"],
      score: 0,
      qualityRank: -1,
    };
  const result = evaluateResolvedRelease(
    profile.resolved,
    evidence.release,
    evidenceMatcher([evidence]),
  );
  const reasons = [
    ...evidence.protectedReasons,
    ...coverageReasons(release, mediaIds),
    ...result.reasons,
  ].map((reason) => `resolved_${reason}`);
  return {
    accepted: result.status === "accepted" && reasons.length === 0,
    reasons,
    score: result.score,
    qualityRank: result.qualityRank,
  };
}
export function chooseResolvedPolicy(input: {
  candidate: ReleaseAttributes;
  current: ReleaseAttributes | null;
  profile: QualityProfile;
  mediaIds: readonly string[];
}) {
  const evaluation = evaluateResolvedPolicy(
    input.candidate,
    input.profile,
    input.mediaIds,
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
    input.current === null ? null : evidenceFor(input.current, input.profile);
  if (
    input.current !== null &&
    (current === null || current.protectedReasons.length > 0)
  )
    return { upgrade: false, reason: "current_evidence_unknown", evaluation };
  const decision = chooseResolvedUpgrade({
    profile: input.profile.resolved,
    candidate: candidate.release,
    current: current?.release ?? null,
    matcher: evidenceMatcher(
      current === null ? [candidate] : [candidate, current],
    ),
  });
  return { upgrade: decision.upgrade, reason: decision.reason, evaluation };
}
