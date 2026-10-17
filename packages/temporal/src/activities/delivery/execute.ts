import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { createHash } from "node:crypto";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliverySelection } from "#lib/delivery/selection.ts";
import {
  argoRequest,
  selectArgoRelease,
  syncArgoRelease,
  verifyArgoRelease,
} from "./argocd.ts";
import { observeDeliveryPods } from "./runtime.ts";
import {
  prepareStaticSite,
  applyStaticSite,
  verifyStaticSite,
} from "./static-site.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";

const path = (id: string) => `deployments/${encodeURIComponent(id)}`;
const detail = async (id: string) =>
  await deliveryRequest(path(id), DeploymentDetailSchema);

export async function prepareDelivery(id: string) {
  const current = await detail(id);
  if (["succeeded", "failed", "canceled"].includes(current.deployment.status))
    return { status: "terminal" } as const;
  try {
    await deliveryRequest(`${path(id)}/claim`, DeploymentDetailSchema, {});
  } catch (error) {
    if (
      error instanceof ApplicationFailure &&
      ["DeliveryApi:PAUSED", "DeliveryApi:BUSY"].includes(error.type ?? "")
    )
      return { status: "waiting" } as const;
    if (
      error instanceof ApplicationFailure &&
      error.type === "DeliveryApi:CONFLICT"
    ) {
      const latest = await detail(id);
      if (
        ["succeeded", "failed", "canceled"].includes(latest.deployment.status)
      )
        return { status: "terminal" } as const;
    }
    throw error;
  }
  return {
    status: "ready",
    workerRollout:
      current.pipeline.definition.kind === "argocd" &&
      current.pipeline.definition.workerRollout !== undefined,
  } as const;
}

async function stage(
  current: DeploymentDetail,
  key: string,
  status: "running" | "succeeded",
  receipt: { operationId: string; evidence?: EvidenceInput[] },
) {
  await deliveryRequest(`${path(current.deployment.id)}/stages`, z.unknown(), {
    key,
    status,
    operationId: receipt.operationId,
    message: `${key}: ${status}`,
    evidence: receipt.evidence ?? [],
  });
}

export async function applyDelivery(id: string): Promise<void> {
  const current = await detail(id);
  if (current.deployment.cancelRequested)
    throw new Error("Delivery cancellation requested before mutation");
  if (current.pipeline.definition.kind === "static-site") {
    const operationId = deliveryOperationId(id);
    await prepareStaticSite(current);
    await stage(current, "preflight", "succeeded", { operationId });
    await stage(current, "reconcile", "running", { operationId });
    await applyStaticSite(current);
    await stage(current, "reconcile", "succeeded", { operationId });
    return;
  }
  const { selection, chart, operationId } = deliverySelection(current);
  const response = await fetch(chart.uri, {
    signal: AbortSignal.any([
      Context.current().cancellationSignal,
      AbortSignal.timeout(30_000),
    ]),
  });
  if (!response.ok)
    throw new Error(
      `Chart inspection returned HTTP ${response.status.toString()}`,
    );
  if (
    `sha256:${createHash("sha256")
      .update(new Uint8Array(await response.arrayBuffer()))
      .digest("hex")}` !== chart.digest
  )
    throw new Error(
      "Published chart bytes differ from the immutable artifact digest",
    );
  await stage(current, "preflight", "succeeded", {
    operationId,
    evidence: [
      {
        kind: "preflight",
        summary: "Selected chart bytes match their immutable digest",
        operationId,
      },
    ],
  });
  // Persist intent before either external mutation. A crash leaves a visible,
  // locked recovery case rather than allowing another release to overwrite it.
  await stage(current, "reconcile", "running", { operationId });
  Context.current().heartbeat({ operationId });
  await selectArgoRelease(selection);
  await syncArgoRelease(selection, operationId);
  await stage(current, "reconcile", "succeeded", {
    operationId,
    evidence: [
      {
        kind: "reconciliation",
        summary: "Guarded exact-revision Argo operation completed",
        operationId,
      },
    ],
  });
}

export async function verifyDelivery(id: string): Promise<EvidenceInput[]> {
  const current = await detail(id);
  if (current.deployment.cancelRequested)
    throw new Error(
      "Delivery cancellation requested; inspect applied release before accepting",
    );
  if (current.pipeline.definition.kind === "static-site")
    return await verifyStaticSite(current);
  const { selection, operationId } = deliverySelection(current);
  const receipt = verifyArgoRelease(
    await argoRequest(encodeURIComponent(selection.application)),
    selection,
    operationId,
  );
  await observeDeliveryPods(current);
  const pipeline = current.pipeline.definition;
  if (pipeline.kind !== "argocd")
    throw new Error("Unsupported pipeline acceptance");
  const evidence: EvidenceInput[] = [
    {
      kind: "reconciliation",
      summary:
        "Owned operation, source, deployment history, Synced and Healthy match exact revision",
      operationId: receipt.operationId,
    },
  ];
  evidence.push({
    kind: "runtime",
    summary: "Selected image digests observed in ready running containers",
    operationId,
  });
  if (pipeline.verification !== undefined) {
    const response = await fetch(pipeline.verification.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (response.status !== pipeline.verification.expectedStatus)
      throw new Error("Application runtime acceptance check failed");
    evidence.push({
      kind: "runtime",
      summary: `Application responded HTTP ${response.status.toString()}`,
      url: pipeline.verification.url,
      operationId,
    });
  }
  evidence.push({
    kind: "acceptance",
    summary: "All configured release acceptance checks passed",
    operationId,
  });
  return evidence;
}

export async function finishDelivery(
  id: string,
  result: {
    status: "succeeded" | "failed" | "canceled";
    evidence: EvidenceInput[];
  },
) {
  const current = await detail(id);
  const recoveryRequired =
    result.status !== "succeeded" &&
    current.stages.some((item) => item.status === "running");
  await deliveryRequest(`${path(id)}/finish`, z.unknown(), {
    ...result,
    status:
      current.deployment.cancelRequested && result.status === "failed"
        ? "canceled"
        : result.status,
    message:
      result.status === "succeeded"
        ? "Release accepted"
        : recoveryRequired
          ? "External operation may still be active; inspect its recorded identity before releasing ownership"
          : "Deployment stopped; inspect Workflow history and recorded evidence",
    recoveryRequired,
    ...(result.status === "succeeded"
      ? { observedRevisionId: current.deployment.versionSetRevisionId }
      : {}),
  });
}
