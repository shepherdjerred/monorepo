import {
  ResolvedProfileSchema,
  ResolvedReleaseSchema,
} from "./resolved-contract.ts";
import type {
  RegexMatcher,
  ResolvedProfile,
  ResolvedRelease,
  SourceQuality,
} from "./resolved-contract.ts";
import { calculateResolvedScore } from "./resolved-formats.ts";
import {
  canonicalLanguage,
  originalAudioPresence,
} from "./quality-guide/language.ts";

export type ResolvedEvaluation = {
  status: "accepted" | "rejected" | "protected";
  reasons: string[];
  qualityRank: number;
  score: number;
  matchedFormats: number[];
  unknownFormats: number[];
};
export function profileQuality(
  profile: ResolvedProfile,
  qualityId: number,
):
  | {
      rank: number;
      allowed: boolean;
      quality: SourceQuality;
    }
  | undefined {
  for (const [rank, item] of profile.profile.items.entries()) {
    if ("quality" in item) {
      if (item.quality.id === qualityId)
        return { rank, allowed: item.allowed, quality: item.quality };
    } else {
      const child = item.items.find((leaf) => leaf.quality.id === qualityId);
      if (child !== undefined)
        return {
          rank,
          allowed: item.allowed && child.allowed,
          quality: child.quality,
        };
    }
  }
  return undefined;
}
/** .NET Convert.ToInt64 rounds midpoint values to even, before multiplying by runtime. */
export function bytesPerMinute(mebibytes: number): number {
  const value = mebibytes * 1024 * 1024;
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}
function sizeReasons(
  profile: ResolvedProfile,
  release: ResolvedRelease,
): string[] {
  if (release.sizeBytes === null) return ["size_unknown"];
  if (profile.source === "sonarr" && release.specialEpisode) return [];
  const definition = profile.qualityDefinitions.find(
    (item) => item.quality.id === release.qualityId,
  );
  if (definition === undefined) return ["quality_definition_missing"];
  const minimum = definition.minSize ?? 0;
  const maximum = definition.maxSize ?? 0;
  if (minimum === 0 && maximum === 0) return [];
  if (release.runtimeMinutes === null) return ["runtime_unknown"];
  if (release.sizeBytes < bytesPerMinute(minimum) * release.runtimeMinutes)
    return ["size_below_minimum"];
  return maximum > 0 &&
    release.sizeBytes > bytesPerMinute(maximum) * release.runtimeMinutes
    ? ["size_above_maximum"]
    : [];
}
function originalAudioReasons(
  release: ResolvedRelease,
  provisional: boolean,
): string[] {
  if (
    release.originalLanguage === null ||
    canonicalLanguage(release.originalLanguage) === null
  )
    return ["language_evidence_unknown"];
  const presence = originalAudioPresence(
    release.originalLanguage,
    release.audioLanguages,
  );
  if (presence === "unknown")
    return provisional ? [] : ["language_evidence_unknown"];
  return presence === "present" ? [] : ["original_audio_missing"];
}
function languageReasons(
  profile: ResolvedProfile,
  release: ResolvedRelease,
  phase: "listing" | "measured",
): string[] {
  if (profile.householdPolicy !== undefined)
    return originalAudioReasons(
      release,
      phase === "listing" &&
        profile.householdPolicy.provisionalUnknownListingAudio,
    );
  if (profile.source === "sonarr") return [];
  const language = profile.profile.language;
  if (language === undefined) return ["language_policy_unknown"];
  if (language.id === -1) return [];
  // Source IDs for concrete languages need an explicit catalog, not a name heuristic.
  if (language.id !== -2) return ["language_policy_unsupported"];
  if (release.audioLanguages === null || release.originalLanguage === null)
    return ["language_evidence_unknown"];
  return release.audioLanguages.includes(release.originalLanguage)
    ? []
    : ["original_audio_missing"];
}
const PROTECTION_REASONS = new Set([
  "identity_unconfirmed",
  "size_unknown",
  "runtime_unknown",
  "quality_definition_missing",
  "language_policy_unknown",
  "language_policy_unsupported",
  "language_evidence_unknown",
  "custom_format_unknown",
]);
export function evaluateResolvedRelease(
  inputProfile: ResolvedProfile,
  inputRelease: ResolvedRelease,
  matcher: RegexMatcher = () => "unknown",
  phase: "listing" | "measured" = "measured",
): ResolvedEvaluation {
  const profile = ResolvedProfileSchema.parse(inputProfile);
  const release = ResolvedReleaseSchema.parse(inputRelease);
  const quality = profileQuality(profile, release.qualityId);
  if (quality === undefined)
    return {
      status: "protected",
      reasons: ["quality_unknown"],
      qualityRank: -1,
      score: 0,
      matchedFormats: [],
      unknownFormats: [],
    };
  const score = calculateResolvedScore(profile, release, quality.quality, {
    matcher,
    phase,
  });
  const reasons = [
    ...sizeReasons(profile, release),
    ...languageReasons(profile, release, phase),
  ];
  if (
    profile.householdPolicy?.rejectedFormatIds.some((id) =>
      score.matched.includes(id),
    ) === true
  )
    reasons.push("incompatible_dynamic_range");
  if (!quality.allowed) reasons.push("quality_rejected");
  if (!release.identityConfirmed) reasons.push("identity_unconfirmed");
  if (score.unknown.length > 0) reasons.push("custom_format_unknown");
  else if (score.score < profile.profile.minFormatScore)
    reasons.push("score_below_minimum");
  return {
    status: reasons.some((reason) => PROTECTION_REASONS.has(reason))
      ? "protected"
      : reasons.length > 0
        ? "rejected"
        : "accepted",
    reasons,
    qualityRank: quality.rank,
    score: score.score,
    matchedFormats: score.matched,
    unknownFormats: score.unknown,
  };
}
