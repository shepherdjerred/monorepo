import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";

export const deploymentPath = (id: string) =>
  `deployments/${encodeURIComponent(id)}`;

export async function deploymentDetail(id: string): Promise<DeploymentDetail> {
  return await deliveryRequest(deploymentPath(id), DeploymentDetailSchema);
}

export function stageOf(current: DeploymentDetail, key: string) {
  return current.stages.find((stage) => stage.key === key);
}

/** Records a step's intent (`running`) or settlement; the operation identity never changes. */
export async function recordStage(
  current: DeploymentDetail,
  key: string,
  status: "running" | "succeeded",
  receipt: {
    operationId: string;
    evidence?: EvidenceInput[];
    message?: string;
  },
) {
  await deliveryRequest(
    `${deploymentPath(current.deployment.id)}/stages`,
    z.unknown(),
    {
      key,
      status,
      operationId: receipt.operationId,
      message: receipt.message ?? `${key}: ${status}`,
      evidence: receipt.evidence ?? [],
    },
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
 * running, owned by its environment and not canceled.
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
