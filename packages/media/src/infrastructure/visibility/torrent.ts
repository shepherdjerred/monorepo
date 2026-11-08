import { z } from "zod";
import type { Torrent } from "#generated/prisma/client.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import { evaluateSeeding } from "#domain/seeding.ts";
import { cleanupDigest } from "./seeding.ts";
import {
  CleanupEvaluationSchema,
  CleanupReasonSchema,
  RecordedSeedingPolicySchema,
} from "#shared/visibility/seeding.ts";
import type { MediaVisibility } from "#shared/visibility/detail.ts";

/** Display freshness only; this is not an effect authorization window. */
export function observationFreshness(
  observedAt: Date | null,
  ownershipEpoch: number,
  epoch: number,
  now: Date,
) {
  if (ownershipEpoch !== epoch) return "old_epoch";
  if (observedAt === null) return "missing";
  if (observedAt > now) return "future";
  return now.getTime() - observedAt.getTime() > 300_000 ? "stale" : "fresh";
}

function recordedPolicy(raw: Torrent["seedingPolicy"]) {
  // Recorded verification prose is private. The obligation consists only of these typed facts.
  const { evidence: _evidence, ...policy } = z
    .looseObject({ evidence: z.string().optional() })
    .parse(raw);
  return RecordedSeedingPolicySchema.parse(policy);
}

type TorrentRelations = Torrent & {
  attempts: { state: string }[];
  assets: { state: string }[];
};
type Observation = z.infer<typeof StoredTorrentObservationSchema> | null;
type Diagnostics = NonNullable<
  MediaVisibility["torrents"][number]["diagnostics"]
>;
type Options = { epoch: number; owner: boolean; now: Date };

function protectionsFor(
  torrent: TorrentRelations,
  observation: Observation,
  freshness: MediaVisibility["torrents"][number]["freshness"],
): Diagnostics["protections"] {
  const protections: NonNullable<
    MediaVisibility["torrents"][number]["diagnostics"]
  >["protections"] = [];
  if (!torrent.owned) protections.push("unowned_torrent");
  if (freshness === "old_epoch") protections.push("old_epoch");
  if (observation === null || freshness === "missing")
    protections.push("missing_observation");
  if (freshness === "stale") protections.push("stale_observation");
  if (freshness === "future") protections.push("future_observation");
  if (observation !== null && !hasApplicationSeedingPolicy(observation))
    protections.push("torrent_policy_drift");
  if (torrent.state === "removing") protections.push("removal_outcome_unknown");
  if (
    torrent.attempts.some((attempt) => attempt.state === "submission_unknown")
  )
    protections.push("submission_outcome_unknown");
  if (
    torrent.attempts.some(
      (attempt) => !["completed", "cancelled"].includes(attempt.state),
    ) ||
    torrent.assets.some(
      (asset) =>
        !["published", "superseded", "quarantined", "purged"].includes(
          asset.state,
        ),
    )
  )
    protections.push("source_in_use");
  return protections;
}

function obligationFor(
  policy: Diagnostics["policy"],
  observation: Observation,
): Diagnostics["obligation"] {
  const evaluated =
    observation === null
      ? null
      : evaluateSeeding(policy, {
          ratio:
            observation.ratio.kind === "finite"
              ? observation.ratio.value
              : observation.ratio,
          seedingSeconds: observation.seeding_time,
          sizeBytes: observation.size,
          complete: observation.progress === 1,
          owned: true,
          dependenciesRemaining: false,
        });
  if (evaluated === null) return null;
  return {
    satisfied: evaluated.eligible,
    reason: CleanupReasonSchema.parse(evaluated.reason),
    requiredSeconds: evaluated.requiredSeconds,
  };
}

function cleanupFor(
  torrent: Torrent,
  options: Options,
  freshness: string,
): Diagnostics["cleanup"] {
  const evaluation =
    torrent.cleanupEvaluation === null
      ? null
      : CleanupEvaluationSchema.parse(torrent.cleanupEvaluation);
  const current =
    evaluation !== null &&
    freshness === "fresh" &&
    evaluation.recoveryEpoch === options.epoch &&
    evaluation.ownershipEpoch === torrent.ownershipEpoch &&
    evaluation.policyDigest === cleanupDigest(torrent.seedingPolicy) &&
    evaluation.observationDigest === cleanupDigest(torrent.observation) &&
    evaluation.observedAt === (torrent.observedAt?.toISOString() ?? null) &&
    new Date(evaluation.evaluatedAt) <= options.now &&
    options.now.getTime() - new Date(evaluation.evaluatedAt).getTime() <=
      300_000;
  return evaluation === null
    ? null
    : {
        status: evaluation.status,
        reason: evaluation.reason,
        evaluatedAt: evaluation.evaluatedAt,
        phase: evaluation.phase,
        freshness: current ? "current" : "stale",
      };
}

export function torrentVisibility(
  torrent: TorrentRelations,
  options: Options,
): MediaVisibility["torrents"][number] {
  const observation =
    torrent.observation === null
      ? null
      : z
          .object({ torrent: StoredTorrentObservationSchema })
          .parse(torrent.observation).torrent;
  const freshness = observationFreshness(
    torrent.observedAt,
    torrent.ownershipEpoch,
    options.epoch,
    options.now,
  );
  const policy = recordedPolicy(torrent.seedingPolicy);
  return {
    id: torrent.id,
    state: torrent.state,
    observedAt: torrent.observedAt?.toISOString() ?? null,
    freshness:
      observation === null && freshness === "fresh" ? "missing" : freshness,
    progress: observation?.progress ?? null,
    ratio: observation?.ratio ?? null,
    seededSeconds: observation?.seeding_time ?? null,
    diagnostics: options.owner
      ? {
          providerId: torrent.providerId,
          policy,
          protections: protectionsFor(torrent, observation, freshness),
          obligation: obligationFor(policy, observation),
          cleanup: cleanupFor(torrent, options, freshness),
        }
      : null,
  };
}
