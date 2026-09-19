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
  startToCloseTimeout: "1 minute",
  retry: { maximumInterval: "5 minutes" },
});
async function settleCommand(command: ImessageCommand): Promise<void> {
  let child;
  try {
    child = await startChild(imessageAgentChatWorkflow, {
      workflowId: `agent-chat-imessage/${command.messageId}`,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [command],
      parentClosePolicy: ParentClosePolicy.ABANDON,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return;
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
    cursor = {
      startedAt: batch.startedAt,
      initialized: batch.initialized,
      lastRowId: batch.lastRowId,
    };
    await sleep(progressed ? "1 second" : "30 seconds");
  }
  return await continueAsNew<typeof blueBubblesIngressWorkflow>(cursor);
}
