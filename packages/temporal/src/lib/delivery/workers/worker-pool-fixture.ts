import { workerHostSpecification } from "@shepherdjerred/delivery/contract";
import type { RolloutCommandResult } from "#lib/worker-deployment-proofs.ts";

/** Native OCI and checkout responses shared by the routing-proof fixtures. */
export function workerProofCommand(
  command: readonly string[],
  imageBuildId: string,
  checkoutBuildId = imageBuildId,
): RolloutCommandResult | undefined {
  if (command[0] === "docker")
    return {
      stdout: JSON.stringify({
        os: "linux",
        architecture: "amd64",
        config: { Env: [`GIT_SHA=${imageBuildId}`] },
      }),
      stderr: "",
    };
  if (command[0] === "git")
    return {
      stdout: command[1] === "rev-parse" ? checkoutBuildId : "",
      stderr: "",
    };
  return undefined;
}

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
