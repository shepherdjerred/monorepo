import { Context } from "@temporalio/activity";
import { REST } from "discord.js";
import { createTemporalClient } from "#client";
import { continueAgentChat, runAgentChatTurn } from "#lib/agent-chat-client.ts";
import {
  DISCORD_MESSAGE_LIMIT,
  DeliverDiscordAgentChatMessageInputSchema,
  DiscordAgentChatCommandResultSchema,
  DiscordAgentChatCommandSchema,
  type DeliverDiscordAgentChatMessageInput,
  type DiscordAgentChatCommand,
  type DiscordAgentChatCommandResult,
} from "#shared/agent/agent-chat-discord.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for Discord agent chat delivery`);
  }
  return value;
}

export function chunkDiscordAgentChatText(text: string): string[] {
  if (text.length === 0) return ["(Agent returned no text.)"];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + DISCORD_MESSAGE_LIMIT, text.length);
    const boundaryCodePoint = text.codePointAt(end - 1);
    if (boundaryCodePoint === undefined) {
      throw new Error("Discord message boundary is outside the response");
    }
    if (boundaryCodePoint > 65_535) {
      end -= 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function sourceFor(command: DiscordAgentChatCommand) {
  return {
    kind: "discord" as const,
    channelId: command.channelId,
    ...(command.threadId === undefined ? {} : { threadId: command.threadId }),
  };
}

export async function executeDiscordAgentChatCommand(
  rawCommand: DiscordAgentChatCommand,
): Promise<DiscordAgentChatCommandResult> {
  const command = DiscordAgentChatCommandSchema.parse(rawCommand);
  const context = Context.current();
  const heartbeat = (): void => {
    context.heartbeat({
      phase: "agent-chat",
      interactionId: command.interactionId,
    });
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  try {
    const client = await createTemporalClient();
    const source = sourceFor(command);
    const request = {
      turnId: `discord-${command.interactionId}`,
      prompt: command.prompt,
      submittedAt: command.submittedAt,
      source,
    };
    const result =
      command.kind === "new"
        ? await runAgentChatTurn({
            client: client.workflow,
            config: {
              chatId: `chat-discord-${command.interactionId}`,
              title: command.title,
              provider: command.provider,
              model: command.model,
              origin: source,
              createdAt: command.submittedAt,
              maxTurnsPerMessage: 24,
            },
            request,
            bindSource: true,
          })
        : await continueAgentChat({
            client: client.workflow,
            request,
            chatId: command.chatId,
          });
    return DiscordAgentChatCommandResultSchema.parse({
      messages: chunkDiscordAgentChatText(result.finalText),
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function deliverDiscordAgentChatMessage(
  rawInput: DeliverDiscordAgentChatMessageInput,
): Promise<void> {
  const input = DeliverDiscordAgentChatMessageInputSchema.parse(rawInput);
  const rest = new REST({ version: "10" }).setToken(
    requiredEnvironment("AGENT_CHAT_DISCORD_TOKEN"),
  );
  await rest.post(`/channels/${input.channelId}/messages`, {
    body: {
      content: input.content,
      allowed_mentions: { parse: [] },
      nonce: input.nonce,
      enforce_nonce: true,
    },
  });
}

export const discordAgentChatActivities = {
  executeDiscordAgentChatCommand,
  deliverDiscordAgentChatMessage,
};
