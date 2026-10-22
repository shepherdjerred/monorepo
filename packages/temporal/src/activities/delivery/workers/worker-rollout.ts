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
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import type {
  DeliveryJobRequest,
  DeliveryJobReceipt,
} from "#shared/delivery-job.ts";
import { workerImageProofInput } from "#lib/delivery/workers/worker-image-proof.ts";
import {
  ControlPlaneTemplatesSchema,
  controlPlaneTemplates,
  requireIsolatedControlPlane,
} from "#lib/delivery/workers/worker-control-plane.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import { workerRolloutTarget } from "#lib/delivery/workers/worker-pool.ts";
import {
  workerPlanEvidence,
  workerRunnerImage,
} from "#lib/delivery/workers/worker-plan.ts";

async function workerJob(
  detail: DeploymentDetail,
  stage: string,
  recipe: "worker-preflight" | "worker-step" | "worker-images",
  input: unknown,
) {
  const rollout = workerRolloutTarget(detail);
  if (rollout === undefined)
    throw new Error("Deployment has no worker rollout definition");
  const image = detail.versionSet.components[rollout.imageComponent];
  if (image?.kind !== "image")
    throw new Error("Worker rollout lacks a qualified candidate image");
  const request: DeliveryJobRequest = {
    deploymentId: detail.deployment.id,
    stageKey: stage,
    recipe,
    runnerImage: workerRunnerImage(detail),
    // Controller implementation belongs to the running qualified executor;
    // candidate replay/canaries use their own immutable source checkout.
    sourceRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .parse(Bun.env["GIT_SHA"]),
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
  let native: DeliveryJobReceipt | undefined;
  const nativeEvidence: EvidenceInput[] = [];
  const result = await runDeliveryJob(request, async (receipt) => {
    native = receipt;
    nativeEvidence.push({
      kind: "preflight",
      summary: `Pinned Job ${receipt.namespace}/${receipt.name}, UID ${receipt.uid}, fingerprint ${receipt.specFingerprint}`,
      operationId: receipt.uid,
    });
    await deliveryRequest(path, z.unknown(), {
      key: stage,
      status: "running",
      operationId,
      message: JSON.stringify(receipt),
      evidence: nativeEvidence,
    });
  });
  if (native === undefined)
    throw new Error("Worker Job did not persist its native identity");
  return { result, operationId, native, nativeEvidence };
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
  address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
};

export async function inspectDeliveryWorkerImages(id: string): Promise<void> {
  const detail = await load(id);
  const job = await workerJob(
    detail,
    "worker-image-provenance",
    "worker-images",
    workerImageProofInput(detail),
  );
  const proof = z
    .object({
      verified: z.literal(true),
      controlPlaneTemplates: ControlPlaneTemplatesSchema,
    })
    .strict()
    .parse(job.result);
  if (detail.deployment.workerSnapshot?.target === "central") {
    const resources = await Promise.all([
      workerApplicationResources("temporal", "Deployment", argoRequest),
      workerApplicationResources("temporal", "StatefulSet", argoRequest),
    ]);
    requireIsolatedControlPlane(proof.controlPlaneTemplates);
    requireIsolatedControlPlane(controlPlaneTemplates(resources.flat()));
  }
  await deliveryRequest(
    `deployments/${encodeURIComponent(id)}/stages`,
    z.unknown(),
    {
      key: "worker-image-provenance",
      status: "succeeded",
      operationId: job.operationId,
      message: JSON.stringify(job.native),
      evidence: [
        ...job.nativeEvidence,
        {
          kind: "preflight",
          operationId: job.operationId,
          summary: JSON.stringify({
            adapter: "worker-image-provenance",
            controlPlaneTemplates: proof.controlPlaneTemplates,
          }),
        },
      ],
    },
  );
}

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
      message: JSON.stringify(job.native),
      // The plan is evidence, so a resumed rollout routes by the same plan.
      evidence: [
        ...job.nativeEvidence,
        workerPlanEvidence(plan, job.operationId),
      ],
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
      message: JSON.stringify(job.native),
      evidence: [...job.nativeEvidence, ...receipt.evidence],
    },
  );
}
