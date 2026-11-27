import type { QualityProfile } from "#shared/contract.ts";
import { QUALITY_GUIDE_VARIANTS } from "#shared/quality-guide/contract.ts";
import type { ResolvedRelease } from "./resolved-contract.ts";
import type { ReleaseEvaluation } from "./release-evaluation.ts";
import { bytesPerMinute } from "./resolved-quality.ts";

const MOVIE_MAX_BYTES = 100_000_000_000;
const EPISODE_MAX_BYTES = 20_000_000_000;

const SOFT_REASONS = new Set([
  "quality_rejected",
  "size_below_minimum",
  "size_above_maximum",
  "runtime_unknown",
  "score_below_minimum",
  "custom_format_unknown",
]);

export function isProgressiveQualityProfile(
  profile: Pick<QualityProfile, "managedGuide">,
) {
  return profile.managedGuide?.variant !== undefined;
}

export function progressiveSizeCeiling(
  profile: QualityProfile,
  itemCount: number,
) {
  return profile.managedGuide?.kind === "series"
    ? EPISODE_MAX_BYTES * itemCount
    : MOVIE_MAX_BYTES;
}

export function progressivePictureRank(
  profile: QualityProfile,
  qualityId: number,
) {
  const quality = profile.resolved?.qualityDefinitions.find(
    (item) => item.quality.id === qualityId,
  )?.quality;
  if (quality === undefined) return null;
  const remux = quality.modifier === "remux" || quality.source === "blurayRaw";
  return (
    quality.resolution * 10 + (remux ? 2 : quality.source === "bluray" ? 1 : 0)
  );
}

export function progressiveUpgrade(
  profile: QualityProfile,
  next: { release: ResolvedRelease; evaluation: ReleaseEvaluation },
  current: { release: ResolvedRelease; evaluation: ReleaseEvaluation },
) {
  const nextRank = progressivePictureRank(profile, next.release.qualityId);
  const currentRank = progressivePictureRank(
    profile,
    current.release.qualityId,
  );
  if (nextRank === null || currentRank === null)
    return "current_evidence_unknown";
  const picture = nextRank - currentRank;
  if (picture < 0) return "quality_downgrade";
  const before = current.evaluation.fallbackDistanceBytes;
  const after = next.evaluation.fallbackDistanceBytes;
  if (
    !current.evaluation.accepted ||
    (before === undefined && after === undefined)
  )
    return null;
  if (before === undefined) return "no_fallback_improvement";
  if (after === undefined)
    return picture > 0 || next.evaluation.score >= current.evaluation.score
      ? "fallback_upgrade"
      : "no_fallback_improvement";
  return picture > 0 && after <= before
    ? "fallback_upgrade"
    : "no_fallback_improvement";
}

/** A fallback may relax only a known quality preference. */
export function progressiveFallbackDistance(
  profile: QualityProfile,
  release: ResolvedRelease,
  reasons: readonly string[],
  hardCeiling: number,
): number | undefined {
  if (
    reasons.length === 0 ||
    reasons.some((reason) => !SOFT_REASONS.has(reason)) ||
    release.sizeBytes === null
  )
    return undefined;
  if (release.runtimeMinutes === null) return Number.MAX_SAFE_INTEGER;
  const definition = profile.resolved?.qualityDefinitions.find(
    (quality) => quality.quality.id === release.qualityId,
  );
  const variant = profile.managedGuide?.variant;
  const maximumPerMinute =
    (variant === undefined
      ? null
      : QUALITY_GUIDE_VARIANTS[variant].sizeTargetMiBPerMinute) ??
    definition?.maxSize;
  const maximum =
    maximumPerMinute == null || maximumPerMinute === 0
      ? hardCeiling
      : Math.min(
          hardCeiling,
          bytesPerMinute(maximumPerMinute) * release.runtimeMinutes,
        );
  const minimum = Math.min(
    maximum,
    bytesPerMinute(definition?.minSize ?? 0) * release.runtimeMinutes,
  );
  return Math.max(0, minimum - release.sizeBytes, release.sizeBytes - maximum);
}
