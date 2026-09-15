import { proxyActivities } from "@temporalio/workflow";
import {
  DiscordAgentChatCommandResultSchema,
  DiscordAgentChatCommandSchema,
  type DiscordAgentChatActivities,
  type DiscordAgentChatCommand,
} from "#shared/agent/agent-chat-discord.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS } from "#shared/agent/agent-chat.ts";

const activities = proxyActivities<DiscordAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

function failureMessage(): string {
  return "The durable agent chat request failed. Check its Temporal execution for details.";
}

function deliveryNonce(interactionId: string, index: number): string {
  return `${interactionId}${index.toString(36).padStart(2, "0")}`;
}

export async function discordAgentChatWorkflow(
  rawCommand: DiscordAgentChatCommand,
): Promise<void> {
  const command = DiscordAgentChatCommandSchema.parse(rawCommand);
  let messages: string[];
  try {
    const result = DiscordAgentChatCommandResultSchema.parse(
      await activities.executeDiscordAgentChatCommand(command),
    );
    messages = result.messages;
  } catch {
    messages = [failureMessage()];
  }

  const deliveryChannelId = command.threadId ?? command.channelId;
  for (const [index, content] of messages.entries()) {
    await activities.deliverDiscordAgentChatMessage({
      channelId: deliveryChannelId,
      content,
      nonce: deliveryNonce(command.interactionId, index),
    });
  }
}
