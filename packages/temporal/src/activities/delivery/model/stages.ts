import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import {
  DELIVERY_API_UNAVAILABLE_WAIT,
  deliveryRequest,
  whileDeliveryApiUnavailable,
} from "#lib/delivery/client.ts";

export const deploymentPath = (id: string) =>
  `deployments/${encodeURIComponent(id)}`;

/**
 * A step's reads and stage writes outlast a short API outage: a self-hosted
 * sync replaces the very API it reads back through (D8). The Activity keeps
 * heartbeating while it waits, and a stage write is safe to repeat because
 * the server accepts the same status and message again unchanged.
 */
async function despiteApiRollout<T>(operation: () => Promise<T>) {
  return await whileDeliveryApiUnavailable(operation, {
    ...DELIVERY_API_UNAVAILABLE_WAIT,
    onWait: (attempt) => {
      Context.current().heartbeat({ deliveryApiUnavailable: attempt });
    },
  });
}

export async function deploymentDetail(id: string): Promise<DeploymentDetail> {
  return await despiteApiRollout(() =>
    deliveryRequest(deploymentPath(id), DeploymentDetailSchema),
  );
}

export function stageOf(current: DeploymentDetail, key: string) {
  return current.stages.find((stage) => stage.key === key);
}

/** Records a step's intent (`running`) or settlement; the operation identity never changes. */
export async function recordStage(
  current: DeploymentDetail,
  key: string,
  status: "running" | "succeeded" | "failed",
  receipt: {
    operationId: string;
    evidence?: EvidenceInput[];
    message?: string;
  },
) {
  const executor = executorIdentity();
  await despiteApiRollout(() =>
    deliveryRequest(
      `${deploymentPath(current.deployment.id)}/stages`,
      z.unknown(),
      {
        key,
        status,
        operationId: receipt.operationId,
        message: receipt.message ?? `${key}: ${status}`,
        evidence: receipt.evidence ?? [],
        // Only the executor that owns the deployment writes its stages (D7).
        executor,
      },
    ),
  );
}

/** The executor names itself with its Workflow execution (D7). */
export function executorIdentity() {
  const execution = Context.current().info.workflowExecution;
  if (execution === undefined)
    throw new Error("Delivery steps run only as Activities of a Workflow");
  return { workflowId: execution.workflowId, workflowRunId: execution.runId };
}

/**
 * Re-reads the deployment before each external effect: it must still be
 * running, owned by its environment and not canceled. A read proves neither
 * a live lease nor the executor's identity; the step's own stage write, which
 * the server accepts only from the owning executor under a live lease, does
 * (D7).
 */
export async function requireOwned(id: string): Promise<DeploymentDetail> {
  const current = await deploymentDetail(id);
  if (
    current.deployment.status !== "running" ||
    current.environment.activeDeploymentId !== id
  )
    throw new Error(`Deployment ${id} no longer owns its environment`);
  if (current.deployment.cancelRequested)
    throw new Error(`Deployment ${id} was canceled before this step`);
  return current;
}
