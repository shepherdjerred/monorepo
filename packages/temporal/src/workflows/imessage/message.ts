import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  AgentChatTurnResultSchema,
} from "#shared/agent/agent-chat.ts";
import type { HttpAgentChatActivities } from "#shared/agent/agent-chat-http.ts";
import {
  ImessageCommandSchema,
  PreparedImessageCommandSchema,
  type ImessageActivities,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const preparation = proxyActivities<ImessageActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});
const execution = proxyActivities<HttpAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_INGRESS_MAX_ATTEMPTS },
});
const delivery = proxyActivities<ImessageActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});
export async function imessageAgentChatWorkflow(
  rawCommand: ImessageCommand,
): Promise<void> {
  const command = ImessageCommandSchema.parse(rawCommand);
  // Resolve the model and selected chat once; Activity results freeze them before any provider effects.
  const prepared = PreparedImessageCommandSchema.parse(
    await preparation.prepareImessageCommand(command),
  );
  let content: string;
  if (prepared.kind === "message") content = prepared.content;
  else {
    try {
      const providerStartDeadline = new Date(
        workflowInfo().startTime.getTime() +
          AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
      ).toISOString();
      const result = AgentChatTurnResultSchema.parse(
        await execution.executeHttpAgentChatCommand({
          command: prepared.command,
          providerStartDeadline,
        }),
      );
      content = result.finalText;
    } catch {
      content =
        "The durable agent chat request failed. Check its Temporal execution; it will not automatically repeat provider effects.";
    }
  }
  await delivery.deliverImessageResponse({
    conversationId: command.conversationId,
    messageId: command.messageId,
    content,
  });
}
