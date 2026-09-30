import { patched, proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
  AGENT_CHAT_SCHEDULE_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS,
  AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS,
  AGENT_CHAT_SETTLEMENT_MARGIN_MS,
  ScheduledAgentChatTurnInputSchema,
  type AgentChatDispatchActivities,
  type AgentChatTurnResult,
  type ScheduledAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<AgentChatDispatchActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_DISPATCH,
  startToCloseTimeout: AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});

const RESULT_PROPAGATION_DEADLINE_PATCH =
  "agent-chat-result-propagation-deadlines-v1";
const LEGACY_SCHEDULE_ADMISSION_TIMEOUT_MS =
  AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS -
  AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS -
  AGENT_CHAT_SETTLEMENT_MARGIN_MS;

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
  const info = workflowInfo();
  const submittedAt = info.startTime;
  const admissionTimeoutMs = patched(RESULT_PROPAGATION_DEADLINE_PATCH)
    ? AGENT_CHAT_SCHEDULE_ADMISSION_TIMEOUT_MS
    : LEGACY_SCHEDULE_ADMISSION_TIMEOUT_MS;
  const providerStartDeadline = new Date(
    submittedAt.getTime() + admissionTimeoutMs,
  );
  return AgentChatTurnResultSchema.parse(
    await activities.dispatchScheduledAgentChatTurn({
      config: input.config,
      request: {
        turnId: info.runId,
        prompt: input.prompt,
        submittedAt: submittedAt.toISOString(),
        providerStartDeadline: providerStartDeadline.toISOString(),
        source: { kind: "schedule", scheduleId: input.scheduleId },
      },
    }),
  );
}
