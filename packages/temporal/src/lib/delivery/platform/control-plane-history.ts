import type { Client } from "@temporalio/client";
import { defaultPayloadConverter } from "@temporalio/common";
import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryWorkflowId } from "@shepherdjerred/delivery/contract";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export type ControlPlaneExecution = {
  deploymentId: string;
  workflowId: string;
  runId: string;
};
export const ControlPlaneReplayReceiptSchema = z.strictObject({
  runId: z.uuid(),
  historySha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export function controlPlaneHistoryFingerprint(history: unknown) {
  return createHash("sha256").update(canonicalJson(history)).digest("hex");
}

/** This is a read-only fence. The operator pauses dispatch before submitting the CP upgrade. */
export async function requireControlPlaneQueueQuiescence(
  client: Client,
  execution: ControlPlaneExecution,
) {
  if (execution.workflowId !== deliveryWorkflowId(execution.deploymentId))
    throw new Error(
      "Control-plane replay Workflow ID differs from its deployment",
    );
  const schedule = await client.schedule
    .getHandle("delivery-dispatch")
    .describe();
  if (
    !schedule.state.paused ||
    schedule.info.runningActions.length > 0 ||
    schedule.action.workflowType !== "deliveryDispatchWorkflow" ||
    schedule.action.taskQueue !== TASK_QUEUES.DELIVERY_WORKFLOWS
  )
    throw new Error(
      "Control-plane upgrade requires paused and idle Delivery dispatch Schedule",
    );
  const current = await client.workflow
    .getHandle(execution.workflowId)
    .describe();
  if (
    current.runId !== execution.runId ||
    current.status.name !== "RUNNING" ||
    current.type !== "deliveryDeploymentWorkflow" ||
    current.taskQueue !== TASK_QUEUES.DELIVERY_WORKFLOWS
  )
    throw new Error(
      "Control-plane replay lost its exact open Workflow run or dedicated queue",
    );
  for await (const open of client.workflow.list({
    query: `ExecutionStatus = 'Running' AND TaskQueue = '${TASK_QUEUES.DELIVERY_WORKFLOWS}'`,
    pageSize: 100,
  })) {
    if (
      open.workflowId !== execution.workflowId ||
      open.runId !== execution.runId
    )
      throw new Error(
        "Another open Delivery Workflow blocks control-plane replacement",
      );
  }
}

export async function controlPlaneHistory(
  client: Client,
  execution: ControlPlaneExecution,
) {
  await requireControlPlaneQueueQuiescence(client, execution);
  const history = await client.workflow
    .getHandle(execution.workflowId, execution.runId)
    .fetchHistory();
  const started = history.events?.[0]?.workflowExecutionStartedEventAttributes;
  const payload = started?.input?.payloads?.[0];
  if (
    payload === undefined ||
    started?.workflowType?.name !== "deliveryDeploymentWorkflow" ||
    started.taskQueue?.name !== TASK_QUEUES.DELIVERY_WORKFLOWS ||
    started.input?.payloads?.length !== 1 ||
    !z
      .strictObject({ deploymentId: z.literal(execution.deploymentId) })
      .safeParse(defaultPayloadConverter.fromPayload(payload)).success
  )
    throw new Error(
      "Control-plane history differs from its exact frozen deployment input",
    );
  return history;
}
export async function requireFreshControlPlaneReplay(
  client: Client,
  execution: ControlPlaneExecution,
  receipt: z.infer<typeof ControlPlaneReplayReceiptSchema>,
) {
  if (
    receipt.runId !== execution.runId ||
    controlPlaneHistoryFingerprint(
      await controlPlaneHistory(client, execution),
    ) !== receipt.historySha256
  )
    throw new Error(
      "Control-plane own history changed after candidate replay; source remains unselected",
    );
}
