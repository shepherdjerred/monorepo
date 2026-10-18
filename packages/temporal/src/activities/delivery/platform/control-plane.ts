import { z } from "zod";
import {
  DeploymentDetailSchema,
  ControlPlaneAcceptanceSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { platformNativeEvidence } from "#lib/delivery/platform/native-job.ts";
import { platformExecutionJob } from "#lib/delivery/platform/job-request.ts";
import { controlPlaneJobInput } from "#lib/delivery/platform/control-plane.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobReceipt,
} from "#shared/delivery-job.ts";

export async function executeControlPlaneWithJob(
  id: string,
  runJob: typeof runDeliveryJob,
): Promise<EvidenceInput[]> {
  const base = `deployments/${encodeURIComponent(id)}`;
  const detail = await deliveryRequest(base, DeploymentDetailSchema);
  if (
    detail.deployment.status !== "running" ||
    detail.deployment.cancelRequested ||
    detail.environment.activeDeploymentId !== id ||
    detail.pipeline.definition.kind !== "control-plane"
  )
    throw new Error(
      "Control-plane execution lacks its exact globally quiescent claim",
    );
  const input = controlPlaneJobInput(detail);
  const request = platformExecutionJob(detail);
  const name = z.string().parse(deliveryJobManifest(request).metadata?.name);
  const existing = detail.stages.find((stage) => stage.key === "control-plane");
  if (
    existing !== undefined &&
    (existing.operationId !== name || existing.status === "failed")
  )
    throw new Error(
      "Control-plane stage identity changed or requires explicit recovery",
    );
  const prior =
    existing?.message.startsWith("{") === true
      ? DeliveryJobReceiptSchema.parse(JSON.parse(existing.message))
      : undefined;
  const checkpoint = async (
    status: "running" | "succeeded",
    message: string,
    evidence: EvidenceInput[],
  ) =>
    await deliveryRequest(`${base}/stages`, z.unknown(), {
      key: "control-plane",
      status,
      operationId: name,
      message,
      evidence,
    });
  if (existing === undefined)
    await checkpoint(
      "running",
      "Waiting for independent identity-bound control-plane Job",
      [],
    );
  let receipt: DeliveryJobReceipt | undefined;
  const prefix: EvidenceInput[] = [];
  const result = await runJob(
    request,
    async (native) => {
      if (prior !== undefined && canonicalJson(prior) !== canonicalJson(native))
        throw new Error(
          "Control-plane continuation replaced its persisted native Job UID",
        );
      receipt = native;
      prefix.push(...platformNativeEvidence(native));
      if (existing?.status !== "succeeded")
        await checkpoint("running", JSON.stringify(native), prefix);
    },
    {
      createIfAbsent: existing === undefined,
      ...(prior === undefined ? {} : { expectedReceipt: prior }),
    },
  );
  if (receipt === undefined)
    throw new Error(
      "Control-plane completion lacks its persisted native Job receipt",
    );
  const accepted = ControlPlaneAcceptanceSchema.parse(result);
  const snapshot = input.snapshot;
  if (
    accepted.nativeJobUID !== receipt.uid ||
    accepted.argoRequestId !== deliveryOperationId(`${id}:control-plane`) ||
    accepted.previousArtifactId !== snapshot.previousArtifact.id ||
    accepted.nextArtifactId !== snapshot.nextArtifact.id ||
    accepted.chartArtifactId !== snapshot.chartArtifact.id
  )
    throw new Error(
      "Control-plane native result differs from its frozen original artifacts/UID",
    );
  const evidence: EvidenceInput[] = [
    ...prefix,
    {
      kind: "reconciliation",
      operationId: accepted.argoOperationId,
      summary:
        "Exact independently owned control-plane chart synchronization finished",
    },
    {
      kind: "runtime",
      operationId: receipt.uid,
      summary:
        "Every selected controller template and native Pod proves the original qualified image",
    },
    {
      kind: "acceptance",
      operationId: receipt.uid,
      summary: JSON.stringify(accepted),
    },
  ];
  await checkpoint("succeeded", JSON.stringify(receipt), evidence);
  return evidence;
}

export async function executeDeliveryControlPlane(
  id: string,
): Promise<EvidenceInput[]> {
  return await executeControlPlaneWithJob(id, runDeliveryJob);
}
