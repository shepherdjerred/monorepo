import { z } from "zod";
import {
  DeploymentDetailSchema,
  EvidenceInputSchema,
  WorkerRolloutPlanSchema,
  WorkerRolloutActionSchema,
  WorkerRolloutSnapshotSchema,
  type WorkerRolloutPlan,
  type WorkerRolloutAction,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";

async function workerJob(
  detail: DeploymentDetail,
  stage: string,
  recipe: "worker-preflight" | "worker-step",
  input: unknown,
) {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.workerRollout === undefined)
    throw new Error("Deployment has no worker rollout definition");
  const image =
    detail.versionSet.components[pipeline.workerRollout.imageComponent];
  if (image?.kind !== "image")
    throw new Error("Worker rollout lacks a qualified candidate image");
  const request: DeliveryJobRequest = {
    deploymentId: detail.deployment.id,
    stageKey: stage,
    recipe,
    runnerImage: pipeline.workerRollout.runnerImage,
    sourceRevision: image.sourceRevision,
    input,
  };
  const operationId = z
    .string()
    .parse(deliveryJobManifest(request).metadata?.name);
  const path = `deployments/${encodeURIComponent(detail.deployment.id)}/stages`;
  await deliveryRequest(path, z.unknown(), {
    key: stage,
    status: "running",
    operationId,
    message: "Waiting for an identity-bound revision-pinned Job",
    evidence: [],
  });
  const result = await runDeliveryJob(request, async (receipt) => {
    await deliveryRequest(path, z.unknown(), {
      key: stage,
      status: "running",
      operationId,
      message: JSON.stringify(receipt),
      evidence: [
        {
          kind: "preflight",
          summary: `Pinned Job ${receipt.namespace}/${receipt.name}, UID ${receipt.uid}, fingerprint ${receipt.specFingerprint}`,
          operationId: receipt.uid,
        },
      ],
    });
  });
  return { result, operationId };
}

async function load(id: string) {
  const detail = await deliveryRequest(
    `deployments/${encodeURIComponent(id)}`,
    DeploymentDetailSchema,
  );
  if (detail.deployment.cancelRequested)
    throw new Error("Worker deployment cancellation requested");
  return detail;
}
const connection = {
  address: "temporal-server.temporal.svc.cluster.local:7233",
};

export async function prepareDeliveryWorker(
  id: string,
): Promise<WorkerRolloutPlan> {
  const detail = await load(id);
  const job = await workerJob(detail, "worker-preflight", "worker-preflight", {
    detail: WorkerRolloutSnapshotSchema.parse(detail),
    connection,
  });
  const plan = WorkerRolloutPlanSchema.parse(job.result);
  await deliveryRequest(
    `deployments/${encodeURIComponent(id)}/stages`,
    z.unknown(),
    {
      key: "worker-preflight",
      status: "succeeded",
      operationId: job.operationId,
      message:
        "Candidate checkout, replay, canary and stable routing prerequisites verified",
      evidence: [],
    },
  );
  return plan;
}

export async function stepDeliveryWorker(
  id: string,
  plan: WorkerRolloutPlan,
  action: WorkerRolloutAction,
): Promise<void> {
  const detail = await load(id);
  const job = await workerJob(detail, `worker-${action}`, "worker-step", {
    detail: WorkerRolloutSnapshotSchema.parse(detail),
    plan: WorkerRolloutPlanSchema.parse(plan),
    action: WorkerRolloutActionSchema.parse(action),
    connection,
  });
  const receipt = z
    .object({
      action: WorkerRolloutActionSchema,
      candidateBuildId: z.string(),
      currentBuildId: z.string(),
      rampingBuildId: z.string(),
      rampPercentage: z.number(),
      evidence: z.array(EvidenceInputSchema),
    })
    .parse(job.result);
  if (
    receipt.action !== action ||
    receipt.candidateBuildId !== plan.candidateBuildId
  )
    throw new Error("Worker Job result does not match its frozen routing step");
  await deliveryRequest(
    `deployments/${encodeURIComponent(id)}/stages`,
    z.unknown(),
    {
      key: `worker-${action}`,
      status: "succeeded",
      operationId: job.operationId,
      message: "Worker routing and observation proofs passed",
      evidence: receipt.evidence,
    },
  );
}
