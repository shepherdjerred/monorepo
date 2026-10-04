import { proxyActivities } from "@temporalio/workflow";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
} from "#shared/agent/agent-chat.ts";
import type { HttpAgentChatActivities } from "#shared/agent/agent-chat-http.ts";
import {
  ImessageCommandSchema,
  PreparedImessageCommandSchema,
  type ImessageActivities,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { imessageReplyContent } from "./reply-content.ts";

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
// Retained for closed-history replay; no Activity worker executes this retired transport.
export async function imessageAgentChatWorkflow(
  rawCommand: ImessageCommand,
): Promise<void> {
  const command = ImessageCommandSchema.parse(rawCommand);
  // Resolve the model and selected chat once; Activity results freeze them before any provider effects.
  const prepared = PreparedImessageCommandSchema.parse(
    await preparation.prepareImessageCommand(command),
  );
  const content = await imessageReplyContent(prepared, execution);
  await delivery.deliverImessageResponse({
    conversationId: command.conversationId,
    messageId: command.messageId,
    content,
  });
}
