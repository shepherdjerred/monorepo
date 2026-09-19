import { z } from "zod/v4";
import {
  AgentChatIdSchema,
  AgentChatPromptSchema,
  AgentChatProviderSchema,
  type AgentChatConfig,
} from "./agent-chat.ts";

export const DISCORD_MESSAGE_LIMIT = 2000;
// Discord only guarantees nonce uniqueness over the preceding few minutes.
// Keep every retry attempt inside a conservative two-minute window.
export const DISCORD_AGENT_CHAT_DELIVERY_TIMEOUT_MS = 2 * 60 * 1000;

const DiscordSnowflakeSchema = z.string().regex(/^\d{17,20}$/);

const DiscordAgentChatNewCommandSchema = z.strictObject({
  kind: z.literal("new"),
  interactionId: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  threadId: DiscordSnowflakeSchema.optional(),
  provider: AgentChatProviderSchema,
  prompt: AgentChatPromptSchema,
  title: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  submittedAt: z.iso.datetime({ offset: true }),
});

const DiscordAgentChatContinueCommandSchema = z.strictObject({
  kind: z.literal("continue"),
  interactionId: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  threadId: DiscordSnowflakeSchema.optional(),
  chatId: AgentChatIdSchema,
  prompt: AgentChatPromptSchema,
  submittedAt: z.iso.datetime({ offset: true }),
});

export const DiscordAgentChatCommandSchema = z.discriminatedUnion("kind", [
  DiscordAgentChatNewCommandSchema,
  DiscordAgentChatContinueCommandSchema,
]);
export type DiscordAgentChatCommand = z.infer<
  typeof DiscordAgentChatCommandSchema
>;
export type DiscordAgentChatNewCommand = Extract<
  DiscordAgentChatCommand,
  { kind: "new" }
>;

export function discordAgentChatSource(command: DiscordAgentChatCommand) {
  return {
    kind: "discord" as const,
    channelId: command.channelId,
    ...(command.threadId === undefined ? {} : { threadId: command.threadId }),
  };
}

export function discordAgentChatConfig(
  command: DiscordAgentChatNewCommand,
): AgentChatConfig {
  const source = discordAgentChatSource(command);
  return {
    chatId: `chat-discord-${command.interactionId}`,
    title: command.title,
    provider: command.provider,
    model: command.model,
    origin: source,
    createdAt: command.submittedAt,
    maxTurnsPerMessage: 24,
  };
}

export const DiscordAgentChatCommandResultSchema = z.strictObject({
  messages: z
    .array(z.string().min(1).max(DISCORD_MESSAGE_LIMIT))
    .min(1)
    .max(100),
});
export type DiscordAgentChatCommandResult = z.infer<
  typeof DiscordAgentChatCommandResultSchema
>;

export const DeliverDiscordAgentChatMessageInputSchema = z.strictObject({
  channelId: DiscordSnowflakeSchema,
  content: z.string().min(1).max(DISCORD_MESSAGE_LIMIT),
  nonce: z.string().min(1).max(25),
});
export type DeliverDiscordAgentChatMessageInput = z.infer<
  typeof DeliverDiscordAgentChatMessageInputSchema
>;

export type DiscordAgentChatActivities = {
  executeDiscordAgentChatCommand: (
    input: DiscordAgentChatCommand,
  ) => Promise<DiscordAgentChatCommandResult>;
  deliverDiscordAgentChatMessage: (
    input: DeliverDiscordAgentChatMessageInput,
  ) => Promise<void>;
};
