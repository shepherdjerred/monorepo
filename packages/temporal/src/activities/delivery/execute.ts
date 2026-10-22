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
  waitForArgoRelease,
} from "./argocd.ts";
import { observeDeliveryPods } from "./runtime.ts";
import {
  prepareStaticSite,
  applyStaticSite,
  verifyStaticSite,
} from "./static-site.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { workerRetirementClaim } from "./workers/worker-claim.ts";
import { bootstrapDeliveryWorkerHosts } from "./workers/worker-bootstrap.ts";
import { verifyWorkerHosts } from "./workers/worker-hosts.ts";
import { acceptWorkerBaseline } from "./workers/worker-baseline.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import { workerSourceFingerprint } from "#lib/delivery/workers/worker-source.ts";
import { workerRolloutTarget } from "#lib/delivery/workers/worker-pool.ts";
import { prepareMinecraftDelivery } from "./minecraft.ts";
import { requireMinecraftPreservation } from "#lib/delivery/minecraft-acceptance.ts";
import { trmnlRepairClaim } from "./trmnl-repair.ts";
import { executorIdentity } from "./model/stages.ts";
import { modelRecipe } from "#lib/delivery/model/recipe.ts";
import { minecraftUpgradeOf } from "@shepherdjerred/delivery/model-contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  acknowledgeReconciledRelease,
  reconciliationAcknowledgementState,
} from "./reconcile-ack.ts";

const path = (id: string) => `deployments/${encodeURIComponent(id)}`;
const detail = async (id: string) =>
  await deliveryRequest(path(id), DeploymentDetailSchema);

async function capturePriorWorkerSource(current: DeploymentDetail) {
  if (
    current.deployment.workerSnapshot === null ||
    current.stages.some((item) => item.key === "worker-prior-source")
  )
    return;
  const rollout = workerRolloutTarget(current);
  if (rollout === undefined)
    throw new Error("Worker snapshot lacks its worker Application");
  const observed = await argoRequest(encodeURIComponent(rollout.application));
  const fingerprint = workerSourceFingerprint(observed);
  const revision = z
    .object({ metadata: z.object({ resourceVersion: z.string().min(1) }) })
    .parse(observed).metadata.resourceVersion;
  await stage(current, "worker-prior-source", "succeeded", {
    operationId: fingerprint,
    evidence: [
      {
        kind: "preflight",
        operationId: fingerprint,
        summary: `Exact Application UID, source, destination and owner captured before worker effects; observed resourceVersion ${revision}`,
      },
    ],
  });
}

async function minecraftEligible(current: DeploymentDetail): Promise<boolean> {
  if (minecraftUpgradeOf(current.pipeline.definition) === undefined)
    return true;
  const result = await prepareMinecraftDelivery(current);
  return result.status === "ready";
}
function adapterFlags(current: DeploymentDetail) {
  const pipeline = current.pipeline.definition;
  return {
    trmnlRepair: current.deployment.kind === "repair-trmnl",
    controlPlane: current.deployment.controlPlaneSnapshot !== null,
    platform: current.deployment.platformSnapshot !== null,
    workerHosts: current.deployment.workerSnapshot !== null,
    minecraftUpgrade:
      pipeline.kind === "argocd" &&
      pipeline.minecraftUpgrade !== undefined &&
      pipeline.minecraftUpgrade.releaseMode !== "retained-volume-restart",
    scoutSite:
      pipeline.kind === "argocd" &&
      pipeline.scoutSite !== undefined &&
      current.deployment.workerSnapshot?.workerOperation === "rollout",
    trmnlPlugins:
      pipeline.kind === "argocd" && pipeline.trmnlPlugins !== undefined,
    workerRollout:
      pipeline.kind === "argocd" &&
      pipeline.workerRollout !== undefined &&
      current.deployment.workerSnapshot?.workerOperation === "rollout",
  };
}

export async function prepareDelivery(id: string) {
  const current = await detail(id);
  if (["succeeded", "failed", "canceled"].includes(current.deployment.status))
    return { status: "terminal" } as const;
  if (!(await minecraftEligible(current)))
    return { status: "waiting" } as const;
  try {
    // The executor names itself on claim so ownership is never transferred
    // silently (D7); specialized proofs ride in the same body.
    await deliveryRequest(`${path(id)}/claim`, DeploymentDetailSchema, {
      ...((await trmnlRepairClaim(current)) ??
        (await workerRetirementClaim(current))),
      executor: executorIdentity(),
    });
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
  await capturePriorWorkerSource(current);
  return {
    status: "ready",
    // A model recipe runs on the step executor (T3).
    model: modelRecipe(current) !== null,
    ...adapterFlags(current),
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
  if (
    current.pipeline.definition.kind === "argocd" &&
    current.pipeline.definition.minecraftUpgrade !== undefined &&
    current.pipeline.definition.minecraftUpgrade.releaseMode !==
      "retained-volume-restart"
  )
    requireMinecraftPreservation(current);
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
  if (current.deployment.kind === "adopt-worker") return;
  // Persist intent before either external mutation. A crash leaves a visible,
  // locked recovery case rather than allowing another release to overwrite it.
  Context.current().heartbeat({ operationId });
  await withBackupActivityHeartbeat(
    Context.current(),
    async () => {
      await bootstrapDeliveryWorkerHosts(current);
    },
    { stage: "worker-host-bootstrap" },
  );
  if (current.deployment.workerSnapshot?.workerOperation === "retire")
    await deliveryRequest(
      `${path(id)}/claim`,
      DeploymentDetailSchema,
      await workerRetirementClaim(current),
    );
  if (current.deployment.forumBaselineSnapshot !== null)
    await deliveryRequest(
      `${path(id)}/forum-baseline-check`,
      z.object({ verified: z.literal(true) }),
      {},
    );
  await stage(current, "reconcile", "running", { operationId });
  await selectArgoRelease(selection);
  await syncArgoRelease(selection, operationId);
  await acknowledgeReconciledRelease(
    reconciliationAcknowledgementState(current),
    operationId,
  );
}

export async function verifyDelivery(id: string): Promise<EvidenceInput[]> {
  const current = await detail(id);
  if (current.deployment.cancelRequested)
    throw new Error(
      "Delivery cancellation requested; inspect applied release before accepting",
    );
  if (current.pipeline.definition.kind === "static-site")
    return await verifyStaticSite(current);
  if (current.deployment.kind === "adopt-worker")
    return await acceptWorkerBaseline(current);
  const { selection, operationId } = deliverySelection(current);
  const pipeline = current.pipeline.definition;
  const frozenSelection = canonicalJson(deliverySelection(current));
  const read = async () =>
    await argoRequest(encodeURIComponent(selection.application));
  const receipt = await waitForArgoRelease(selection, operationId, {
    read,
    wait: Bun.sleep,
    fence: async () => {
      const fresh = await detail(id);
      if (
        fresh.deployment.cancelRequested ||
        fresh.deployment.status !== "running" ||
        fresh.environment.activeDeploymentId !== id ||
        canonicalJson(deliverySelection(fresh)) !== frozenSelection
      )
        throw new Error(
          "Deployment ownership or frozen selection changed while waiting",
        );
    },
  });
  await observeDeliveryPods(current);
  await verifyWorkerHosts(current);
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
  if (
    pipeline.scoutSite !== undefined &&
    current.deployment.workerSnapshot?.workerOperation === "rollout"
  )
    await stage(current, "scout-backend", "succeeded", {
      operationId,
      evidence,
    });
  if (pipeline.trmnlPlugins !== undefined)
    await stage(current, "trmnl-backend", "succeeded", {
      operationId,
      evidence,
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
    (current.deployment.kind === "repair-trmnl" ||
      current.stages.some((item) => item.status === "running"));
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
    ...(result.status === "succeeded" &&
    current.deployment.kind !== "adopt-worker" &&
    current.deployment.kind !== "repair-trmnl" &&
    current.deployment.platformSnapshot === null &&
    current.deployment.controlPlaneSnapshot === null
      ? { observedRevisionId: current.deployment.versionSetRevisionId }
      : {}),
  });
}
