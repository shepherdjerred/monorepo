import type { Overview } from "@shepherdjerred/delivery/contract";
import type { DeliveryEvidence, RunningPod, Verdict } from "./types.ts";

export async function deliveryEvidence(
  overview: Overview,
  application: string,
  commit: string,
  contains: (ancestor: string, descendant: string) => Promise<boolean>,
): Promise<DeliveryEvidence | null> {
  const environment = overview.environments.find(
    (candidate) => candidate.application === application,
  );
  if (environment === undefined) return null;
  const selected = overview.versionSets.find(
    (version) => version.id === environment.desiredVersionSetRevisionId,
  );
  const artifacts = await Promise.all(
    Object.entries(selected?.components ?? {})
      .filter(([, artifact]) => artifact.kind === "image")
      .map(async ([component, artifact]) => ({
        component,
        digest: artifact.digest,
        runtimeDigests: artifact.runtimeDigests,
        sourceRevision: artifact.sourceRevision,
        containsCommit: await contains(commit, artifact.sourceRevision),
      })),
  );
  return {
    environmentId: environment.id,
    desired: environment.desiredVersionSetRevisionId,
    observed: environment.observedVersionSetRevisionId,
    accepted: environment.acceptedVersionSetRevisionId,
    observedAt: environment.observedAt,
    activeDeploymentId: environment.activeDeploymentId,
    artifacts,
  };
}

export function deliveryVerdict(
  evidence: DeliveryEvidence,
  merged: boolean,
  pods: RunningPod[],
): Verdict {
  if (!merged) return "NOT_MERGED";
  if (evidence.artifacts.length === 0) return "UNKNOWN";
  if (!evidence.artifacts.every((artifact) => artifact.containsCommit))
    return "PENDING";
  return evidence.artifacts.every((artifact) =>
    pods.some(
      (pod) =>
        pod.digest !== null &&
        [artifact.digest, ...artifact.runtimeDigests].includes(pod.digest),
    ),
  )
    ? "RUNNING"
    : "SELECTED";
}
