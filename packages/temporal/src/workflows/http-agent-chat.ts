import { proxyActivities } from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
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
  startToCloseTimeout: "2 hours",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

export async function httpAgentChatWorkflow(
  rawCommand: HttpAgentChatCommand,
): Promise<AgentChatTurnResult> {
  const command = HttpAgentChatCommandSchema.parse(rawCommand);
  return AgentChatTurnResultSchema.parse(
    await activities.executeHttpAgentChatCommand(command),
  );
}
