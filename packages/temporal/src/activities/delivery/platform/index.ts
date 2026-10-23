import { z } from "zod";
import {
  DeploymentDetailSchema,
  RecordTofuPlanSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import { executeDeliveryControlPlane } from "./control-plane.ts";
import { platformNativeEvidence } from "#lib/delivery/platform/native-job.ts";
import { platformExecutionJob } from "#lib/delivery/platform/job-request.ts";
import { TofuStateMarkerSchema } from "#lib/delivery/platform/tofu-input.ts";
import { inspectDeliveryPlatformRecovery } from "./recovery.ts";
import { runDeliveryModelPlatformStep } from "./model-tofu.ts";
import { executorIdentity } from "#activities/delivery/model/stages.ts";

/** All platform authority stays on its dedicated Activity queue and ServiceAccount. */
export async function executePlatformWithJob(
  id: string,
  runJob: typeof runDeliveryJob,
): Promise<EvidenceInput[]> {
  const base = `deployments/${encodeURIComponent(id)}`;
  const detail = await deliveryRequest(base, DeploymentDetailSchema);
  const snapshot = detail.deployment.platformSnapshot;
  const pipeline = detail.pipeline.definition;
  if (
    snapshot === null ||
    snapshot.kind === "root-release" ||
    pipeline.kind !== "tofu" ||
    detail.deployment.cancelRequested ||
    detail.environment.activeDeploymentId !== id
  )
    throw new Error("Platform execution lacks its exact frozen active claim");
  const request = platformExecutionJob(detail);
  const operationId = z
    .string()
    .parse(deliveryJobManifest(request).metadata?.name);
  const stage = async (
    status: "running" | "succeeded",
    message: string,
    evidence: EvidenceInput[],
  ) =>
    await deliveryRequest(`${base}/stages`, z.unknown(), {
      key: snapshot.kind,
      status,
      operationId,
      message,
      evidence,
      executor: executorIdentity(),
    });
  await stage("running", "Waiting for exact qualified platform Job", []);
  let receipt: DeliveryJobReceipt | undefined;
  const nativeEvidence: EvidenceInput[] = [];
  const result = await runJob(request, async (native) => {
    receipt = native;
    nativeEvidence.push(...platformNativeEvidence(native));
    await stage("running", JSON.stringify(native), nativeEvidence);
  });
  if (receipt === undefined)
    throw new Error("Platform Job has no persisted native receipt");
  let summary: string;
  if (snapshot.kind === "tofu-plan") {
    const plan = RecordTofuPlanSchema.parse(result);
    if (
      canonicalJson(plan.receipt.nativeJob) !== canonicalJson(receipt) ||
      plan.receipt.deploymentId !== id ||
      plan.receipt.sourceBuildId !== snapshot.source.id ||
      plan.receipt.sourceRevision !== snapshot.source.sourceRevision ||
      plan.receipt.stack !== snapshot.stack
    )
      throw new Error(
        "Saved plan result differs from its frozen source or actual native Job",
      );
    await deliveryRequest("platform/plans", z.unknown(), plan);
    summary = JSON.stringify({
      adapter: "platform",
      kind: snapshot.kind,
      sourceBuildId: snapshot.source.id,
      stack: snapshot.stack,
      planDigest: plan.receipt.planDigest,
    });
  } else {
    const applied = z
      .object({
        stack: z.literal(snapshot.stack),
        planDeploymentId: z.literal(snapshot.planDeploymentId),
        planDigest: z.literal(snapshot.plan.planDigest),
        outcome: z.literal("applied-saved-plan"),
        state: z.object({
          lineage: z.literal(snapshot.plan.state.lineage),
          serial: z.number().int().min(snapshot.plan.state.serial),
        }),
        marker: TofuStateMarkerSchema.refine(
          (marker) =>
            marker.deploymentId === id && marker.stack === snapshot.stack,
          "State marker names another deployment or stack",
        ),
      })
      .strict()
      .parse(result);
    summary = JSON.stringify({
      adapter: "platform",
      kind: snapshot.kind,
      sourceBuildId: snapshot.source.id,
      stack: snapshot.stack,
      planDigest: snapshot.plan.planDigest,
      stateSerial: applied.marker.stateSerial,
    });
  }
  const evidence: EvidenceInput[] = [
    ...nativeEvidence,
    {
      kind: "reconciliation",
      operationId: receipt.uid,
      summary: `Exact ${snapshot.kind} native Job completed`,
    },
    { kind: "acceptance", operationId: receipt.uid, summary },
  ];
  await stage("succeeded", JSON.stringify(receipt), evidence);
  return evidence;
}

export async function executeDeliveryPlatform(
  id: string,
): Promise<EvidenceInput[]> {
  return await executePlatformWithJob(id, runDeliveryJob);
}
export const platformDeliveryActivities = {
  runDeliveryModelPlatformStep,
  executeDeliveryPlatform,
  executeDeliveryControlPlane,
  inspectDeliveryPlatformRecovery,
};
export type PlatformDeliveryActivities = typeof platformDeliveryActivities;
