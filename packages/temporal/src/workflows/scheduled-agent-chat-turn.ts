import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
  ScheduledAgentChatTurnInputSchema,
  type AgentChatDispatchActivities,
  type AgentChatTurnResult,
  type ScheduledAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<AgentChatDispatchActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_DISPATCH,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});

export async function scheduledAgentChatTurnWorkflow(
  rawInput: ScheduledAgentChatTurnInput,
): Promise<AgentChatTurnResult> {
  const input = ScheduledAgentChatTurnInputSchema.parse(rawInput);
  if (
    input.config.origin.kind !== "schedule" ||
    input.config.origin.scheduleId !== input.scheduleId
  ) {
    throw new Error("Scheduled agent chat origin does not match its schedule");
  }
  return AgentChatTurnResultSchema.parse(
    await activities.dispatchScheduledAgentChatTurn({
      config: input.config,
      request: {
        turnId: workflowInfo().runId,
        prompt: input.prompt,
        submittedAt: new Date().toISOString(),
        source: { kind: "schedule", scheduleId: input.scheduleId },
      },
    }),
  );
}
