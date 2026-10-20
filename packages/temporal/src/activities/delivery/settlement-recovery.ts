import { z } from "zod";
import {
  FinishDeploymentSchema,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

export function requireSettlementOwner(input: {
  deploymentId: string;
  status: string;
  activeDeploymentId: string | null;
}) {
  // A lost Activity acknowledgement may follow a committed finish. Replaying the
  // canonical finish is safe: PostgreSQL compares its immutable result fingerprint.
  if (["failed", "canceled"].includes(input.status)) return;
  if (
    input.status !== "running" ||
    input.activeDeploymentId !== input.deploymentId
  )
    throw new Error("Deployment ownership changed before failure settlement");
}

const failedResult = FinishDeploymentSchema.pick({
  status: true,
  evidence: true,
}).refine((value) => value.status !== "succeeded", {
  message: "Outage settlement cannot manufacture successful acceptance",
});

/** Recover only a recorded failure settlement, never an external-effect Activity. */
export function settlementRecoveryPlan(input: {
  deploymentId: string;
  runId: string;
  activityId: string;
  workflowType: string;
  workflowStatus: string;
  taskQueue: string;
  pending: readonly { id: string; type: string; state: number }[];
  scheduled: readonly { id: string; type: string; args: unknown[] }[];
}) {
  z.uuid().parse(input.deploymentId);
  z.uuid().parse(input.runId);
  z.string().regex(/^\d+$/u).parse(input.activityId);
  if (
    input.workflowType !== "deliveryDeploymentWorkflow" ||
    input.workflowStatus !== "RUNNING" ||
    input.taskQueue !== "delivery-workflows" ||
    input.pending.length !== 1 ||
    input.pending[0]?.id !== input.activityId ||
    input.pending[0].type !== "finishDelivery" ||
    input.pending[0].state !== 1
  )
    throw new Error(
      "Recovery requires the exact scheduled finishDelivery Activity and open Delivery run",
    );
  const scheduled = input.scheduled.find(
    (item) => item.id === input.activityId,
  );
  if (
    scheduled?.type !== "finishDelivery" ||
    scheduled.args.length !== 2 ||
    scheduled.args[0] !== input.deploymentId
  )
    throw new Error(
      "Settlement history differs from the requested deployment and Activity",
    );
  const result = failedResult.parse(scheduled.args[1]);
  return {
    deploymentId: input.deploymentId,
    runId: input.runId,
    activityId: input.activityId,
    queue: `delivery-settlement/${input.runId}/${input.activityId}`,
    result,
  };
}

export function requireSettlementTask(
  plan: ReturnType<typeof settlementRecoveryPlan>,
  task: { workflowId: string; runId: string; activityId: string },
  deploymentId: string,
  result: unknown,
) {
  if (
    task.workflowId !== deliveryWorkflowId(plan.deploymentId) ||
    task.runId !== plan.runId ||
    task.activityId !== plan.activityId ||
    deploymentId !== plan.deploymentId ||
    canonicalJson(failedResult.parse(result)) !== canonicalJson(plan.result)
  )
    throw new Error(
      "Settlement task no longer matches its inspected immutable history",
    );
}
