import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliverySelection } from "#lib/delivery/selection.ts";
import { executorIdentity } from "./model/stages.ts";

type Effects = {
  read: () => Promise<ReturnType<typeof reconciliationAcknowledgementState>>;
  post: (body: ReturnType<typeof completion>) => Promise<unknown>;
  wait: (ms: number) => Promise<unknown>;
  heartbeat: () => void;
};

export function reconciliationAcknowledgementState(detail: DeploymentDetail) {
  return {
    deployment: {
      id: detail.deployment.id,
      status: detail.deployment.status,
      cancelRequested: detail.deployment.cancelRequested,
    },
    environment: {
      id: detail.environment.id,
      generation: detail.environment.generation,
      activeDeploymentId: detail.environment.activeDeploymentId,
    },
    selection: canonicalJson(deliverySelection(detail)),
    stages: detail.stages.map(({ key, status, operationId, message }) => ({
      key,
      status,
      operationId,
      message,
    })),
    evidence: detail.evidence.map(
      ({ id, kind, summary, operationId, url }) => ({
        id,
        kind,
        summary,
        operationId,
        url,
      }),
    ),
  };
}

function completion(operationId: string) {
  return {
    key: "reconcile",
    status: "succeeded" as const,
    operationId,
    message: "reconcile: succeeded",
    evidence: [
      {
        kind: "reconciliation" as const,
        summary: "Guarded exact-revision Argo operation completed",
        operationId,
      },
    ],
  };
}

function acknowledged(
  expected: ReturnType<typeof reconciliationAcknowledgementState>,
  fresh: ReturnType<typeof reconciliationAcknowledgementState>,
  record: ReturnType<typeof completion>,
) {
  if (
    fresh.deployment.id !== expected.deployment.id ||
    fresh.deployment.status !== "running" ||
    fresh.deployment.cancelRequested ||
    fresh.environment.id !== expected.environment.id ||
    fresh.environment.activeDeploymentId !== expected.deployment.id ||
    fresh.environment.generation !== expected.environment.generation ||
    fresh.selection !== expected.selection
  )
    throw new Error(
      "Deployment ownership or selection changed before reconciliation acknowledgement",
    );
  const stage = fresh.stages.find((item) => item.key === "reconcile");
  if (
    stage?.operationId !== record.operationId ||
    !["running", "succeeded"].includes(stage.status)
  )
    throw new Error("Reconciliation operation changed before acknowledgement");
  if (stage.status === "running") return false;
  if (
    stage.message !== record.message ||
    record.evidence.some(
      (item, offset) =>
        !fresh.evidence.some(
          (stored) =>
            stored.id ===
              `${expected.deployment.id}/stage/reconcile/${String(offset)}` &&
            stored.kind === item.kind &&
            stored.summary === item.summary &&
            stored.operationId === item.operationId &&
            stored.url === undefined,
        ),
    )
  )
    throw new Error(
      "Completed reconciliation evidence differs from the exact acknowledgement",
    );
  return true;
}

function acknowledgementEffects(
  expected: ReturnType<typeof reconciliationAcknowledgementState>,
  operationId: string,
): Effects {
  return {
    read: async () =>
      reconciliationAcknowledgementState(
        await deliveryRequest(
          `deployments/${encodeURIComponent(expected.deployment.id)}`,
          DeploymentDetailSchema,
        ),
      ),
    post: (body) =>
      deliveryRequest(
        `deployments/${encodeURIComponent(expected.deployment.id)}/stages`,
        z.unknown(),
        { ...body, executor: executorIdentity() },
      ),
    wait: Bun.sleep,
    heartbeat: () => {
      Context.current().heartbeat({
        operationId,
        stage: "reconcile-acknowledgement",
      });
    },
  };
}

/** Only the post-native-success journal write is retried; no native command is reachable here. */
export async function acknowledgeReconciledRelease(
  expected: ReturnType<typeof reconciliationAcknowledgementState>,
  operationId: string,
  effects?: Effects,
) {
  effects ??= acknowledgementEffects(expected, operationId);
  const record = completion(operationId);
  let timeout: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      effects.heartbeat();
      if (acknowledged(expected, await effects.read(), record)) return;
      effects.heartbeat();
      await effects.post(record);
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "TimeoutError")
        throw error;
      timeout = error;
    }
    await effects.wait(1000);
  }
  effects.heartbeat();
  if (!acknowledged(expected, await effects.read(), record)) throw timeout;
}
