import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
  ScheduledAgentChatTurnInputSchema,
  type AgentChatDispatchActivities,
  type AgentChatTurnResult,
  type ScheduledAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<AgentChatDispatchActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_DISPATCH,
  startToCloseTimeout: "3 hours",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
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
