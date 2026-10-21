import { z } from "zod";
import {
  DeploymentDetailSchema,
  type EvidenceInput,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobRequest,
  type DeliveryJobReceipt,
} from "#shared/delivery-job.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { controlPlaneJobInput } from "./control-plane.ts";
import { tofuJobInputFor, tofuJobRequestInput } from "./tofu-input.ts";

export function platformNativeEvidence(
  native: DeliveryJobReceipt,
): EvidenceInput[] {
  return [
    {
      kind: "preflight",
      operationId: native.uid,
      summary: `Exact platform Job ${native.namespace}/${native.name}; fingerprint ${native.specFingerprint}`,
    },
  ];
}

function frozenJobInput(
  current: DeploymentDetail,
  request: DeliveryJobRequest,
): unknown {
  if (request.recipe === "control-plane") {
    if (
      current.deployment.controlPlaneSnapshot?.source.sourceRevision !==
      request.sourceRevision
    )
      throw new Error(
        "Native controller source differs from its frozen intent",
      );
    return controlPlaneJobInput(current);
  }
  const snapshot = current.deployment.platformSnapshot;
  if (
    snapshot?.kind !== "tofu-apply" ||
    snapshot.kind !== request.recipe ||
    snapshot.source.sourceRevision !== request.sourceRevision
  )
    throw new Error(
      "Native platform source differs from its frozen mutation intent",
    );
  return tofuJobRequestInput(tofuJobInputFor(current, snapshot));
}

/** A Job may start before the create response reaches its Activity: checkpoint its own native identity first. */
export async function admitPlatformNativeJob(request: DeliveryJobRequest) {
  const native = DeliveryJobReceiptSchema.parse({
    namespace: z
      .literal("delivery-platform-jobs")
      .parse(Bun.env["DELIVERY_JOB_NAMESPACE"]),
    name: Bun.env["DELIVERY_JOB_NAME"],
    uid: z.uuid().parse(Bun.env["DELIVERY_JOB_UID"]),
    specFingerprint: Bun.env["DELIVERY_JOB_FINGERPRINT"],
    requestId: request.deploymentId,
  });
  const base = `deployments/${encodeURIComponent(request.deploymentId)}`;
  const current = await deliveryRequest(base, DeploymentDetailSchema);
  const expected = frozenJobInput(current, request);
  const snapshot = current.deployment.platformSnapshot;
  const controller = current.deployment.controlPlaneSnapshot;
  const stage = current.stages.find((item) => item.key === request.stageKey);
  if (
    current.deployment.status !== "running" ||
    current.deployment.cancelRequested ||
    current.environment.activeDeploymentId !== request.deploymentId ||
    stage?.status !== "running" ||
    stage.operationId !== native.name
  )
    throw new Error(
      "Native platform Job lacks its exact frozen active mutation intent",
    );
  if (canonicalJson(expected) !== canonicalJson(request.input))
    throw new Error(
      "Native platform Job input differs from its authoritative immutable snapshot",
    );
  if (
    stage.message.startsWith("{") &&
    canonicalJson(DeliveryJobReceiptSchema.parse(JSON.parse(stage.message))) !==
      canonicalJson(native)
  )
    throw new Error(
      "Native platform Job differs from the recorded UID/fingerprint",
    );
  await deliveryRequest(`${base}/stages`, z.unknown(), {
    key: request.stageKey,
    status: "running",
    operationId: native.name,
    message: JSON.stringify(native),
    evidence: platformNativeEvidence(native),
  });
  const claimed = await deliveryRequest(
    `${base}/claim`,
    DeploymentDetailSchema,
    {},
  );
  if (
    claimed.deployment.status !== "running" ||
    claimed.deployment.cancelRequested ||
    claimed.environment.activeDeploymentId !== request.deploymentId ||
    canonicalJson(claimed.deployment.platformSnapshot) !==
      canonicalJson(snapshot) ||
    canonicalJson(claimed.deployment.controlPlaneSnapshot) !==
      canonicalJson(controller)
  )
    throw new Error(
      "Native platform mutation lost its fresh claim or frozen snapshot",
    );
  return native;
}
