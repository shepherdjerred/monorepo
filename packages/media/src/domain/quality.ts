import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import {
  evaluateResolvedPolicy,
  chooseResolvedPolicy,
} from "./resolved-policy.ts";

import type { ReleaseEvaluation } from "./release-evaluation.ts";

/** Qualities are ordered from least to most desirable. Unknown qualities reject. */
export function evaluateRelease(
  release: ReleaseAttributes,
  profile: QualityProfile,
  requiredMediaIds: readonly string[],
): ReleaseEvaluation {
  if (profile.resolved !== undefined)
    return evaluateResolvedPolicy(release, profile, requiredMediaIds);
  validateProfile(profile);
  const reasons: string[] = [];
  const qualityRank = profile.qualities.indexOf(release.quality);
  if (release.identityConfidence !== "exact")
    reasons.push("identity_unconfirmed");
  if (requiredMediaIds.length === 0) reasons.push("coverage_unspecified");
  if (requiredMediaIds.some((id) => !release.mediaIds.includes(id)))
    reasons.push("incomplete_coverage");
  if (qualityRank === -1) reasons.push("quality_rejected");
  if (profile.rejectedCodecs.includes(release.codec))
    reasons.push("codec_rejected");
  if (
    profile.requiredAudioLanguages.some(
      (language) => !release.audioLanguages.includes(language),
    )
  ) {
    reasons.push("audio_language_missing");
  }
  if (!Number.isSafeInteger(release.sizeBytes) || release.sizeBytes <= 0)
    reasons.push("size_unknown");
  else if (
    release.sizeBytes < profile.minimumBytes ||
    release.sizeBytes > profile.maximumBytes
  ) {
    reasons.push("size_rejected");
  }
  const score = [...new Set(release.scoreTags)].reduce(
    (sum, tag) => sum + (profile.tagScores[tag] ?? 0),
    0,
  );
  if (score < profile.minimumScore) reasons.push("score_below_minimum");
  return { accepted: reasons.length === 0, reasons, qualityRank, score };
}

function validateProfile(profile: QualityProfile): void {
  if (
    !Number.isSafeInteger(profile.minimumBytes) ||
    !Number.isSafeInteger(profile.maximumBytes) ||
    profile.minimumBytes < 0 ||
    profile.maximumBytes < profile.minimumBytes ||
    !Number.isFinite(profile.cutoffScore) ||
    !Number.isFinite(profile.minimumScore) ||
    Object.values(profile.tagScores).some((score) => !Number.isFinite(score))
  ) {
    throw new Error("Quality profile has invalid numeric rules");
  }
  if (
    profile.qualities.length === 0 ||
    new Set(profile.qualities).size !== profile.qualities.length ||
    !profile.qualities.includes(profile.cutoffQuality)
  ) {
    throw new Error("Quality profile has invalid quality ordering or cutoff");
  }
}

export function chooseUpgrade(input: {
  candidate: ReleaseAttributes;
  current: ReleaseAttributes | null;
  profile: QualityProfile;
  mediaIds: readonly string[];
}): { upgrade: boolean; reason: string; evaluation: ReleaseEvaluation } {
  if (input.profile.resolved !== undefined) return chooseResolvedPolicy(input);
  const evaluation = evaluateRelease(
    input.candidate,
    input.profile,
    input.mediaIds,
  );
  if (!evaluation.accepted)
    return { upgrade: false, reason: "candidate_rejected", evaluation };
  if (input.current === null)
    return { upgrade: true, reason: "initial_acquisition", evaluation };
  if (input.candidate.id === input.current.id)
    return { upgrade: false, reason: "same_release", evaluation };
  const current = evaluateRelease(input.current, input.profile, input.mediaIds);
  const cutoffRank = input.profile.qualities.indexOf(
    input.profile.cutoffQuality,
  );
  if (cutoffRank === -1)
    throw new Error("Quality cutoff is not present in the profile");
  if (
    current.accepted &&
    current.qualityRank >= cutoffRank &&
    current.score >= input.profile.cutoffScore
  ) {
    return { upgrade: false, reason: "cutoff_reached", evaluation };
  }
  const better =
    !current.accepted ||
    evaluation.qualityRank > current.qualityRank ||
    (evaluation.qualityRank === current.qualityRank &&
      evaluation.score > current.score);
  return {
    upgrade: better,
    reason: better ? "profile_improvement" : "no_improvement",
    evaluation,
  };
}
