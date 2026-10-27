import type {
  RegexMatcher,
  ResolvedProfile,
  ResolvedRelease,
} from "./resolved-contract.ts";
import { evaluateResolvedRelease } from "./resolved-quality.ts";
import type { ResolvedEvaluation } from "./resolved-quality.ts";

function cutoffRank(profile: ResolvedProfile): number {
  const cutoff = profile.profile.cutoff;
  return profile.profile.items.findIndex((item) =>
    "quality" in item
      ? item.quality.id === cutoff
      : item.id === cutoff ||
        item.items.some((child) => child.quality.id === cutoff),
  );
}
function compareRevision(
  candidate: ResolvedRelease,
  current: ResolvedRelease,
): number | null {
  return candidate.revision === null || current.revision === null
    ? null
    : Math.sign(candidate.revision.real - current.revision.real) ||
        Math.sign(candidate.revision.version - current.revision.version);
}
type UpgradeDecision = {
  upgrade: boolean;
  reason: string;
  evaluation: ResolvedEvaluation;
};
type UpgradeContext = {
  profile: ResolvedProfile;
  candidate: ResolvedRelease;
  current: ResolvedRelease;
  next: ResolvedEvaluation;
  previous: ResolvedEvaluation;
};
function upgradeGates(
  context: UpgradeContext,
  revision: number,
  quality: number,
): string | null {
  const { profile, candidate, current, next, previous } = context;
  const sameQualityRevision =
    revision > 0 && candidate.qualityId === current.qualityId;
  const rules = profile.profile;
  const firstAllowed = rules.items.findIndex((item) => item.allowed);
  const cutoff = rules.upgradeAllowed ? cutoffRank(profile) : firstAllowed;
  if (cutoff < 0) throw new Error("Resolved profile has no valid cutoff");
  const belowQualityCutoff =
    previous.qualityRank < cutoff || sameQualityRevision;
  const belowScoreCutoff =
    previous.score <
    (rules.upgradeAllowed ? rules.cutoffFormatScore : rules.minFormatScore);
  if (!belowQualityCutoff && !belowScoreCutoff) return "cutoff_reached";
  const improvement =
    quality > 0 ||
    (revision > 0 && quality === 0) ||
    next.score > previous.score;
  if (improvement && !sameQualityRevision && !rules.upgradeAllowed)
    return "upgrades_disabled";
  return belowQualityCutoff && quality > 0 ? "quality_upgrade" : null;
}
function upgradeReason(context: UpgradeContext): string {
  const { profile, candidate, current, next, previous } = context;
  const quality = Math.sign(next.qualityRank - previous.qualityRank);
  const revision = compareRevision(candidate, current);
  if (revision === null) return unknownRevisionReason(context, quality);
  const rules = profile.profile;
  const gate = upgradeGates(context, revision, quality);
  if (gate !== null) return gate;
  if (quality < 0) return "quality_downgrade";
  if (revision > 0 && profile.properPreference !== "doNotPrefer")
    return "revision_upgrade";
  if (!rules.upgradeAllowed) return "upgrades_disabled";
  if (revision < 0 && profile.properPreference !== "doNotPrefer")
    return "revision_downgrade";
  if (quality > 0) return "quality_cutoff_reached";
  if (next.score <= previous.score) return "score_not_improved";
  if (previous.score >= rules.cutoffFormatScore) return "score_cutoff_reached";
  return next.score < previous.score + rules.minUpgradeFormatScore
    ? "minimum_score_increment"
    : "format_upgrade";
}
function unknownRevisionReason(
  context: UpgradeContext,
  quality: number,
): string {
  if (quality <= 0)
    return quality < 0 ? "quality_downgrade" : "revision_unknown";
  // Quality-rank improvements precede revision comparison in the pinned source.
  // https://raw.githubusercontent.com/Radarr/Radarr/v6.4.4.10685/src/NzbDrone.Core/DecisionEngine/Specifications/UpgradableSpecification.cs
  return upgradeGates(context, 0, quality) ?? "quality_cutoff_reached";
}
export function chooseResolvedUpgrade(input: {
  profile: ResolvedProfile;
  candidate: ResolvedRelease;
  current: ResolvedRelease | null;
  matcher?: RegexMatcher;
}): UpgradeDecision {
  const evaluation = evaluateResolvedRelease(
    input.profile,
    input.candidate,
    input.matcher,
  );
  if (evaluation.status !== "accepted")
    return {
      upgrade: false,
      reason: `candidate_${evaluation.status}`,
      evaluation,
    };
  if (input.current === null)
    return { upgrade: true, reason: "initial_acquisition", evaluation };
  if (input.current.id === input.candidate.id)
    return { upgrade: false, reason: "same_release", evaluation };
  const previous = evaluateResolvedRelease(
    input.profile,
    input.current,
    input.matcher,
  );
  if (previous.status === "protected")
    return { upgrade: false, reason: "current_evidence_unknown", evaluation };
  const reason = upgradeReason({
    profile: input.profile,
    candidate: input.candidate,
    current: input.current,
    next: evaluation,
    previous,
  });
  return {
    upgrade: ["quality_upgrade", "revision_upgrade", "format_upgrade"].includes(
      reason,
    ),
    reason,
    evaluation,
  };
}
