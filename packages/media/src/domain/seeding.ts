export const SECONDS_PER_DAY = 86_400;

export type SeedingPolicy =
  | { kind: "public" }
  | { kind: "unknown" }
  | { kind: "privatehd"; verified: boolean; ratio: number | null }
  | {
      kind: "private";
      verified: boolean;
      ratio: number | null;
      minimumSeconds: number | null;
      combination: "all" | "any";
      sizeRule: {
        secondsPerGiB: number;
        minimumSeconds: number;
        maximumSeconds: number | null;
      } | null;
    };

export type TorrentObservation = {
  ratio: number | { kind: "infinite" };
  seedingSeconds: number;
  sizeBytes: number;
  complete: boolean;
  owned: boolean;
  dependenciesRemaining: boolean;
};

type SeedingEvaluation = {
  eligible: boolean;
  reason: string;
  requiredSeconds: number | null;
};

const hold = (reason: string): SeedingEvaluation => ({
  eligible: false,
  reason,
  requiredSeconds: null,
});

export function evaluateSeeding(
  policy: SeedingPolicy,
  torrent: TorrentObservation,
): SeedingEvaluation {
  if (!torrent.owned) return hold("unowned_torrent");
  if (!torrent.complete) return hold("download_incomplete");
  if (torrent.dependenciesRemaining) return hold("source_in_use");
  if (
    ![torrent.seedingSeconds, torrent.sizeBytes].every((value) =>
      Number.isFinite(value),
    ) ||
    (typeof torrent.ratio === "number" &&
      (!Number.isFinite(torrent.ratio) || torrent.ratio < 0)) ||
    torrent.seedingSeconds < 0 ||
    torrent.sizeBytes <= 0
  ) {
    return hold("invalid_observation");
  }
  if (policy.kind === "unknown") return hold("policy_required");
  if (policy.kind === "public") {
    const requiredSeconds = 7 * SECONDS_PER_DAY;
    const eligible =
      ratioSatisfied(torrent.ratio, 1) ||
      torrent.seedingSeconds >= requiredSeconds;
    return {
      eligible,
      reason: eligible ? "obligations_satisfied" : "seeding_required",
      requiredSeconds,
    };
  }
  if (!policy.verified) return hold("policy_unverified");
  return policy.kind === "privatehd"
    ? evaluatePrivateHd(policy.ratio, torrent)
    : evaluatePrivateSeeding(policy, torrent);
}

function evaluatePrivateHd(
  ratio: number | null,
  torrent: TorrentObservation,
): SeedingEvaluation {
  const requiredSeconds = privateHdRequiredSeconds(torrent.sizeBytes);
  if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0))
    throw new Error("Invalid PrivateHD ratio requirement");
  const eligible =
    (ratio !== null && ratioSatisfied(torrent.ratio, ratio)) ||
    torrent.seedingSeconds >= requiredSeconds;
  return {
    eligible,
    reason: eligible ? "obligations_satisfied" : "seeding_required",
    requiredSeconds,
  };
}

function privateRequiredSeconds(
  policy: Extract<SeedingPolicy, { kind: "private" }>,
  sizeBytes: number,
): number | null {
  let requiredSeconds = policy.minimumSeconds;
  if (policy.sizeRule !== null) {
    const rule = policy.sizeRule;
    if (
      ![rule.secondsPerGiB, rule.minimumSeconds].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      (rule.maximumSeconds !== null &&
        (!Number.isFinite(rule.maximumSeconds) ||
          rule.maximumSeconds < rule.minimumSeconds))
    ) {
      throw new Error("Invalid private size policy");
    }
    const scaled = Math.max(
      rule.minimumSeconds,
      Math.ceil((sizeBytes / 1024 ** 3) * rule.secondsPerGiB),
    );
    const sizeSeconds =
      rule.maximumSeconds === null
        ? scaled
        : Math.min(scaled, rule.maximumSeconds);
    requiredSeconds = Math.max(requiredSeconds ?? 0, sizeSeconds);
  }
  return requiredSeconds;
}

function evaluatePrivateSeeding(
  policy: Extract<SeedingPolicy, { kind: "private" }>,
  torrent: TorrentObservation,
): SeedingEvaluation {
  const requiredSeconds = privateRequiredSeconds(policy, torrent.sizeBytes);
  const requirements: boolean[] = [];
  if (policy.ratio !== null) {
    if (!Number.isFinite(policy.ratio) || policy.ratio < 0)
      throw new Error("Invalid private ratio policy");
    requirements.push(ratioSatisfied(torrent.ratio, policy.ratio));
  }
  if (requiredSeconds !== null) {
    if (!Number.isFinite(requiredSeconds) || requiredSeconds < 0)
      throw new Error("Invalid private time policy");
    requirements.push(torrent.seedingSeconds >= requiredSeconds);
  }
  if (requirements.length === 0) return hold("policy_required");
  const eligible =
    policy.combination === "all"
      ? requirements.every(Boolean)
      : requirements.some(Boolean);
  return {
    eligible,
    reason: eligible ? "obligations_satisfied" : "seeding_required",
    requiredSeconds,
  };
}

function ratioSatisfied(
  ratio: TorrentObservation["ratio"],
  required: number,
): boolean {
  return typeof ratio !== "number" || ratio >= required;
}

/** Existing PrivateHD rule: decimal GB, rounded up to complete minutes. */
export function privateHdRequiredSeconds(sizeBytes: number): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0)
    throw new Error("Torrent size must be positive");
  const gigabytes = sizeBytes / 1_000_000_000;
  const hours =
    gigabytes <= 1
      ? 72
      : gigabytes < 50
        ? 72 + 2 * gigabytes
        : 100 * Math.log(gigabytes) - 219.2023;
  return Math.ceil(hours * 60) * 60;
}
