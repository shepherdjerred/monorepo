import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  HttpAgentChatCommandSchema,
  type HttpAgentChatActivities,
  type HttpAgentChatCommand,
} from "#shared/agent/agent-chat-http.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<HttpAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_INGRESS_MAX_ATTEMPTS },
});

export async function httpAgentChatWorkflow(
  rawCommand: HttpAgentChatCommand,
): Promise<AgentChatTurnResult> {
  const command = HttpAgentChatCommandSchema.parse(rawCommand);
  const providerStartDeadline = new Date(
    workflowInfo().startTime.getTime() +
      AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  ).toISOString();
  return AgentChatTurnResultSchema.parse(
    await activities.executeHttpAgentChatCommand({
      command,
      providerStartDeadline,
    }),
  );
}
