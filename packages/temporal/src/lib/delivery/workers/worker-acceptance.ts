import { z } from "zod";
import {
  DeploymentSchema,
  WorkerRolloutSnapshotSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { workerRolloutTarget } from "./worker-pool.ts";

/** Job input retains the immutable request identity and the restored acceptance. */
export const WorkerRoutingSnapshotSchema = WorkerRolloutSnapshotSchema.extend({
  deployment: DeploymentSchema.pick({
    id: true,
    environmentId: true,
    serviceId: true,
    versionSetRevisionId: true,
    pipelineRevisionId: true,
    configurationId: true,
    kind: true,
    restoredDeploymentId: true,
    status: true,
    finishedAt: true,
    workerSnapshot: true,
  }),
});
export type WorkerRoutingSnapshot = z.infer<typeof WorkerRoutingSnapshotSchema>;
export const WorkerRoutingInputSchema = z.strictObject({
  detail: WorkerRoutingSnapshotSchema,
  restored: WorkerRoutingSnapshotSchema.nullable(),
});

const ACCEPTED_WORKER_KINDS: ReadonlySet<string> = new Set([
  "deploy",
  "promote",
  "rollback",
  "rebind",
  "retire-host",
  "carry",
]);

/** A rollback restores accepted production evidence, not beta's mutable Current. */
export function workerAcceptanceMode(
  detail: WorkerRoutingSnapshot,
  restored: WorkerRoutingSnapshot | null,
): "prerequisite" | "restoration" {
  const request = detail.deployment;
  if (request.kind !== "rollback") {
    if (restored !== null || request.restoredDeploymentId !== null)
      throw new Error("Only a rollback may carry a restored worker acceptance");
    return "prerequisite";
  }
  if (restored === null)
    throw new Error("Rollback requires its previously accepted deployment");
  requireRestoredSelection(detail, restored);
  requireRestoredImage(detail, restored);
  return "restoration";
}

function requireRestoredSelection(
  detail: WorkerRoutingSnapshot,
  restored: WorkerRoutingSnapshot,
) {
  const request = detail.deployment;
  if (
    request.restoredDeploymentId !== restored.deployment.id ||
    request.id === restored.deployment.id ||
    restored.deployment.status !== "succeeded" ||
    restored.deployment.finishedAt === null ||
    !ACCEPTED_WORKER_KINDS.has(restored.deployment.kind)
  )
    throw new Error(
      "Rollback requires its exact previously accepted deployment",
    );
  for (const key of [
    "environmentId",
    "serviceId",
    "versionSetRevisionId",
    "pipelineRevisionId",
    "configurationId",
  ] as const) {
    if (request[key] !== restored.deployment[key])
      throw new Error(`Restored worker acceptance differs at ${key}`);
  }
  if (
    request.versionSetRevisionId !== detail.versionSet.id ||
    restored.deployment.versionSetRevisionId !== restored.versionSet.id ||
    request.pipelineRevisionId !== detail.pipeline.id ||
    restored.deployment.pipelineRevisionId !== restored.pipeline.id
  )
    throw new Error(
      "Restored worker selection differs from its frozen records",
    );
}

function requireRestoredImage(
  detail: WorkerRoutingSnapshot,
  restored: WorkerRoutingSnapshot,
) {
  const policy = workerRolloutTarget(detail);
  const previousPolicy = workerRolloutTarget(restored);
  const artifact =
    policy === undefined
      ? undefined
      : detail.versionSet.components[policy.imageComponent];
  const previousArtifact =
    previousPolicy === undefined
      ? undefined
      : restored.versionSet.components[previousPolicy.imageComponent];
  const pool = restored.deployment.workerSnapshot;
  if (
    policy === undefined ||
    previousPolicy?.target !== policy.target ||
    previousPolicy.imageComponent !== policy.imageComponent ||
    artifact?.kind !== "image" ||
    previousArtifact?.kind !== "image" ||
    artifact.id !== previousArtifact.id ||
    artifact.sourceRevision !== previousArtifact.sourceRevision ||
    artifact.uri !== previousArtifact.uri ||
    artifact.digest !== previousArtifact.digest ||
    pool?.environmentId !== detail.deployment.environmentId ||
    pool.target !== policy.target ||
    pool.candidateBuildId !== artifact.sourceRevision ||
    !pool.versions.some(
      (worker) =>
        worker.replicas === 1 &&
        worker.buildId === artifact.sourceRevision &&
        worker.artifactId === artifact.id &&
        worker.image === `${artifact.uri}@${artifact.digest}`,
    )
  )
    throw new Error("Rollback image lacks matching accepted worker evidence");
}

/** Both values come from authenticated Delivery reads, then freeze into the Job. */
export function workerRoutingInput(
  detail: DeploymentDetail,
  restored: DeploymentDetail | null,
) {
  const input = WorkerRoutingInputSchema.parse({ detail, restored });
  workerAcceptanceMode(input.detail, input.restored);
  return input;
}
