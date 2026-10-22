import { workerHostSpecification } from "@shepherdjerred/delivery/contract";

/**
 * Test fixture: the central rollout pool of temporal/prod, a stable host
 * beside the candidate, each image digest named by its Build ID's letter.
 */
export function centralRolloutPool(input: {
  stable: string;
  candidate: string;
  candidateArtifactId: string;
}) {
  return {
    schema: "delivery-worker-pool/v1",
    environmentId: "temporal/prod",
    environmentGeneration: 0,
    target: "central",
    candidateBuildId: input.candidate,
    versions: [input.stable, input.candidate].map((buildId) => ({
      id: `worker/${buildId}`,
      environmentId: "temporal/prod",
      buildId,
      artifactId:
        buildId === input.candidate
          ? input.candidateArtifactId
          : "image/stable",
      artifactBuildId: `build/${buildId}`,
      sourceRevision: buildId,
      image: `docker.io/shepherdjerred/temporal-worker@sha256:${buildId.slice(0, 1).repeat(64)}`,
      digest: `sha256:${buildId.slice(0, 1).repeat(64)}`,
      introducedByDeploymentId: "deployment/0",
      host: workerHostSpecification("central"),
      replicas: 1,
      generation: 0,
      retiredAt: null,
    })),
  };
}
