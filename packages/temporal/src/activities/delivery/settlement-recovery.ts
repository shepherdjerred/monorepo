import { z } from "zod";
import {
  FinishDeploymentSchema,
  EvidenceInputSchema,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

export function requireSettlementOwner(input: {
  deploymentId: string;
  status: string;
  activeDeploymentId: string | null;
  recordedStatus: "succeeded" | "failed" | "canceled";
}) {
  // A lost Activity acknowledgement may follow a committed finish. Replaying the
  // canonical finish is safe: PostgreSQL compares its immutable result fingerprint.
  if (
    input.status === input.recordedStatus ||
    (input.recordedStatus === "failed" && input.status === "canceled")
  )
    return;
  if (
    input.status !== "running" ||
    input.activeDeploymentId !== input.deploymentId
  )
    throw new Error("Deployment ownership changed before result settlement");
}

const recordedResult = FinishDeploymentSchema.pick({
  status: true,
  evidence: true,
});

const acceptanceActivities = new Set([
  "verifyDelivery",
  "applyDeliveryScoutSite",
  "applyDeliveryTrmnlPlugins",
  "executeDeliveryPlatform",
  "executeDeliveryControlPlane",
]);

/** Recover an exact recorded settlement, never an external-effect Activity. */
export function settlementRecoveryPlan(input: {
  deploymentId: string;
  runId: string;
  activityId: string;
  workflowType: string;
  workflowStatus: string;
  taskQueue: string;
  pending: readonly { id: string; type: string; state: number }[];
  scheduled: readonly { id: string; type: string; args: unknown[] }[];
  completed: readonly { type: string; result: unknown }[];
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
  const result = recordedResult.parse(scheduled.args[1]);
  if (result.status === "succeeded") {
    const observations = input.completed.filter((item) =>
      acceptanceActivities.has(item.type),
    );
    const evidence = observations.flatMap((item) =>
      z.array(EvidenceInputSchema).parse(item.result),
    );
    if (
      observations.length === 0 ||
      evidence.length === 0 ||
      canonicalJson(evidence) !== canonicalJson(result.evidence)
    )
      throw new Error(
        "Successful settlement lacks its recorded acceptance evidence",
      );
  }
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
    canonicalJson(recordedResult.parse(result)) !== canonicalJson(plan.result)
  )
    throw new Error(
      "Settlement task no longer matches its inspected immutable history",
    );
}
