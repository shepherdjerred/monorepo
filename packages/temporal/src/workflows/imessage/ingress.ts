import {
  continueAsNew,
  log,
  ParentClosePolicy,
  proxyActivities,
  sleep,
  startChild,
  WorkflowIdReusePolicy,
} from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import { AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS } from "#shared/agent/agent-chat.ts";
import {
  BlueBubblesCursorSchema,
  BlueBubblesPollResultSchema,
  type BlueBubblesCursor,
  type ImessageActivities,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { imessageAgentChatWorkflow } from "./message.ts";

const activities = proxyActivities<ImessageActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
  startToCloseTimeout: "2 minutes",
  retry: { maximumInterval: "5 minutes" },
});
const duplicateCommandWait = proxyActivities<
  Pick<ImessageActivities, "waitForImessageCommand">
>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
  startToCloseTimeout: AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS,
  retry: { maximumAttempts: 1 },
});
async function settleCommand(command: ImessageCommand): Promise<void> {
  const workflowId = `agent-chat-imessage/${command.messageId}`;
  let child;
  try {
    child = await startChild(imessageAgentChatWorkflow, {
      workflowId,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [command],
      parentClosePolicy: ParentClosePolicy.ABANDON,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      workflowExecutionTimeout: AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      try {
        await duplicateCommandWait.waitForImessageCommand(workflowId);
      } catch {
        log.error(
          "iMessage command failed; inspect its durable execution before retrying",
          { workflowId },
        );
      }
      return;
    }
    throw error;
  }
  // Selection commands and new-chat binding must settle before the next message resolves its binding.
  try {
    await child.result();
  } catch {
    log.error(
      "iMessage command failed; inspect its durable execution before retrying",
      { workflowId: child.workflowId },
    );
  }
}
export async function blueBubblesIngressWorkflow(
  rawCursor: BlueBubblesCursor,
): Promise<never> {
  let cursor = BlueBubblesCursorSchema.parse(rawCursor);
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const batch = BlueBubblesPollResultSchema.parse(
      await activities.pollBlueBubblesMessages(cursor),
    );
    if (batch.lastRowId < cursor.lastRowId)
      throw new Error("BlueBubbles cursor moved backwards");
    for (const command of batch.commands) {
      await settleCommand(command);
    }
    // Advance only after every qualifying command has been durably admitted.
    const progressed = batch.lastRowId > cursor.lastRowId;
    cursor = batch.initialized
      ? {
          startedAt: batch.startedAt,
          initialized: true,
          lastRowId: batch.lastRowId,
          sourceEpoch: batch.sourceEpoch,
        }
      : {
          startedAt: batch.startedAt,
          initialized: false,
          lastRowId: batch.lastRowId,
          sourceEpoch: batch.sourceEpoch,
          ...(batch.initializationHighWaterRowId === undefined
            ? {}
            : {
                initializationHighWaterRowId:
                  batch.initializationHighWaterRowId,
              }),
        };
    await sleep(progressed ? "1 second" : "30 seconds");
  }
  return await continueAsNew<typeof blueBubblesIngressWorkflow>(cursor);
}
