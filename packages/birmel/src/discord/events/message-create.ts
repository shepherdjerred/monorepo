import type { Client, Message } from "discord.js";
import { TRIGGER_PATTERNS } from "../../config/constants.js";
import { logger } from "../../utils/logger.js";

export type MessageContext = {
  message: Message;
  content: string;
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
};

export type MessageHandler = (context: MessageContext) => Promise<void>;

let messageHandler: MessageHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

function shouldRespond(message: Message, clientId: string): boolean {
  // Ignore messages from bots
  if (message.author.bot) return false;

  // Check if bot is mentioned
  if (message.mentions.has(clientId)) return true;

  // Check for trigger patterns in content
  const content = message.content.toLowerCase();
  return TRIGGER_PATTERNS.some((pattern) => pattern.test(content));
}

export function setupMessageCreateHandler(client: Client): void {
  client.on("messageCreate", (message: Message) => {
    void (async () => {
      // Only process guild messages for now
      if (!message.guild) {
        return;
      }
      if (!client.user) {
        return;
      }

      if (!shouldRespond(message, client.user.id)) {
        return;
      }

      logger.debug("Processing message", {
        guildId: message.guild.id,
        channelId: message.channel.id,
        userId: message.author.id,
        content: message.content.slice(0, 100),
      });

      if (!messageHandler) {
        logger.warn("No message handler registered");
        return;
      }

      try {
        await messageHandler({
          message,
          content: message.content,
          guildId: message.guild.id,
          channelId: message.channel.id,
          userId: message.author.id,
          username: message.author.username,
        });
      } catch (error) {
        logger.error("Error handling message", error);
        try {
          await message.reply(
            "Sorry, I encountered an error processing your request.",
          );
        } catch {
          // Ignore reply errors -- eslint-disable-line @typescript-eslint/no-empty-pattern
        }
      }
    })();
  });
}
