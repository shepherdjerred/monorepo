export type ProviderSelection = {
  priority: number;
  minimumSeeders: number;
  delaySeconds: number;
  bypassAtHighestQuality: boolean;
};

export function evaluateProviderSelection(input: {
  policy: ProviderSelection;
  seeders: number | null;
  firstSeenAt: number;
  now: number;
  qualityRank: number;
  highestQualityRank: number;
  rejected: boolean;
}): { accepted: boolean; reason: string | null; eligibleAt: number | null } {
  if (input.rejected)
    return {
      accepted: false,
      reason: "release_previously_rejected",
      eligibleAt: null,
    };
  if (
    input.policy.minimumSeeders > 0 &&
    (input.seeders === null || input.seeders < input.policy.minimumSeeders)
  )
    return {
      accepted: false,
      reason: "minimum_seeders_not_met",
      eligibleAt: null,
    };
  if (input.firstSeenAt > input.now)
    return {
      accepted: false,
      reason: "release_observation_clock_invalid",
      eligibleAt: null,
    };
  const bypass =
    input.policy.bypassAtHighestQuality &&
    input.qualityRank >= 0 &&
    input.qualityRank === input.highestQualityRank;
  const eligibleAt = input.firstSeenAt + input.policy.delaySeconds * 1000;
  return !bypass && eligibleAt > input.now
    ? { accepted: false, reason: "release_delay_pending", eligibleAt }
    : { accepted: true, reason: null, eligibleAt: null };
}

/** Lower numbers win only after quality rank and custom-format score tie. */
export function compareProviderCandidates(
  left: { rank: number; score: number; priority: number; id: string },
  right: { rank: number; score: number; priority: number; id: string },
) {
  return (
    right.rank - left.rank ||
    right.score - left.score ||
    left.priority - right.priority ||
    left.id.localeCompare(right.id)
  );
}
