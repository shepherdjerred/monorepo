import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/common";
import { z } from "zod";
import { type WorkerRecoveryIntent } from "@shepherdjerred/delivery/contract";
import { createTemporalClient } from "#client";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

async function ensureRecoveryWorkflow(
  client: Awaited<ReturnType<typeof createTemporalClient>>,
  intent: Pick<WorkerRecoveryIntent, "id" | "workflowId" | "submittedAt">,
  workflowType:
    | "deliveryWorkerRecoveryWorkflow"
    | "deliveryPlatformRecoveryWorkflow"
    | "deliveryMinecraftRecoveryWorkflow"
    | "deliveryForumBaselineWorkflow",
) {
  try {
    return await client.workflow.getHandle(intent.workflowId).describe();
  } catch (error) {
    if (
      !(error instanceof WorkflowNotFoundError) ||
      intent.submittedAt !== null
    )
      throw error;
  }
  try {
    await client.workflow.start(workflowType, {
      taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
      workflowId: intent.workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [{ intentId: intent.id }],
    });
    return;
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    return await client.workflow.getHandle(intent.workflowId).describe();
  }
}

/** Recovery dispatch continues while ordinary deployment admission is paused. */
export async function dispatchDeliveryWorkerRecoveries(): Promise<void> {
  await dispatchRecoveryIntents({
    path: "worker-recovery",
    workflowType: "deliveryWorkerRecoveryWorkflow",
  });
}
export async function dispatchRecoveryIntents(input: {
  path:
    | "worker-recovery"
    | "platform-recovery"
    | "minecraft-recovery"
    | "forum/baselines";
  workflowType:
    | "deliveryWorkerRecoveryWorkflow"
    | "deliveryPlatformRecoveryWorkflow"
    | "deliveryMinecraftRecoveryWorkflow"
    | "deliveryForumBaselineWorkflow";
}): Promise<void> {
  const pending = await deliveryRequest(
    `${input.path}/pending`,
    z.object({
      intents: z.array(
        z.object({
          id: z.string(),
          workflowId: z.string(),
          submittedAt: z.iso.datetime().nullable(),
        }),
      ),
    }),
  );
  const client = await createTemporalClient("prod");
  for (const intent of pending.intents) {
    const existing = await ensureRecoveryWorkflow(
      client,
      intent,
      input.workflowType,
    );
    if (existing !== undefined && existing.type !== input.workflowType)
      throw new Error("Recovery identity belongs to another Workflow type");
    if (existing !== undefined && existing.status.name !== "RUNNING") {
      await deliveryRequest(
        `${input.path}/${encodeURIComponent(intent.id)}/fail`,
        z.unknown(),
        {
          message:
            "Native intent Workflow closed without independently verified completion",
        },
      );
      continue;
    }
    await deliveryRequest(
      `${input.path}/${encodeURIComponent(intent.id)}/submitted`,
      z.unknown(),
      { workflowId: intent.workflowId },
    );
  }
}
