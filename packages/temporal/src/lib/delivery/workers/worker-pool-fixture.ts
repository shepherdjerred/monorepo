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

/** A deterministic UUID-shaped identifier, as Delivery's real keys are. */
function uuid(index: number, salt: string) {
  const hex = `${salt}${index.toString(16)}`.padStart(32, "0").slice(-32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Test fixture: `count` retired central hosts as Delivery keeps them in the
 * frozen pool, at zero replicas with a retirement time, sized like
 * production rows (UUID keys, CI artifact ids, a runtime digest).
 */
export function retiredCentralWorkers(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const buildId = `${index.toString(16).padStart(12, "0")}${"e".repeat(28)}`;
    const digest = `sha256:${index.toString(16).padStart(64, "0")}`;
    return {
      id: uuid(index, "1d"),
      environmentId: "temporal/prod",
      buildId,
      artifactId: `ci/1/${String(10_000 + index)}/image/temporal-worker`,
      artifactBuildId: uuid(index, "2b"),
      sourceRevision: buildId,
      image: `docker.io/shepherdjerred/temporal-worker@${digest}`,
      digest,
      runtimeDigests: [`sha256:${index.toString(16).padStart(64, "f")}`],
      introducedByDeploymentId: uuid(index, "3d"),
      host: workerHostSpecification("central"),
      replicas: 0,
      generation: 1,
      retiredAt: "2026-10-21T23:24:02.736Z",
    };
  });
}
