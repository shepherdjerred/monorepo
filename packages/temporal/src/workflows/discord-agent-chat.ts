import { proxyActivities } from "@temporalio/workflow";
import {
  DISCORD_AGENT_CHAT_DELIVERY_TIMEOUT_MS,
  DiscordAgentChatCommandResultSchema,
  DiscordAgentChatCommandSchema,
  type DiscordAgentChatActivities,
  type DiscordAgentChatCommand,
} from "#shared/agent/agent-chat-discord.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS } from "#shared/agent/agent-chat.ts";

const commandActivities = proxyActivities<DiscordAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

const deliveryActivities = proxyActivities<DiscordAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: "30 seconds",
  scheduleToCloseTimeout: DISCORD_AGENT_CHAT_DELIVERY_TIMEOUT_MS,
  retry: {
    initialInterval: "1 second",
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
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
      await commandActivities.executeDiscordAgentChatCommand(command),
    );
    messages = result.messages;
  } catch {
    messages = [failureMessage()];
  }

  const deliveryChannelId = command.threadId ?? command.channelId;
  for (const [index, content] of messages.entries()) {
    await deliveryActivities.deliverDiscordAgentChatMessage({
      channelId: deliveryChannelId,
      content,
      nonce: deliveryNonce(command.interactionId, index),
    });
  }
}
