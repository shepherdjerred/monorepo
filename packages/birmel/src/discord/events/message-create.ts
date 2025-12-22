import type { Client, Message } from "discord.js";
import type { getClassifierAgent as GetClassifierAgentFn } from "../../mastra/index.js";
import type { parseClassificationResult as ParseClassificationResultFn } from "../../mastra/agents/classifier-agent.js";
import { logger } from "../../utils/logger.js";
import {
  getRecentChannelMessages,
  formatMessagesForClassifier,
} from "../utils/channel-history.js";

// Lazy-loaded to avoid circular dependency with tools
let classifierModule: { getClassifierAgent: typeof GetClassifierAgentFn } | null = null;
let parserModule: { parseClassificationResult: typeof ParseClassificationResultFn } | null = null;

async function getClassifierAgent() {
  classifierModule ??= await import("../../mastra/index.js");
  return classifierModule.getClassifierAgent();
}

async function getParseClassificationResult() {
  parserModule ??= await import("../../mastra/agents/classifier-agent.js");
  return parserModule.parseClassificationResult;
}

export type MessageContext = {
  message: Message;
  content: string;
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
  referencedMessage?: {
    content: string;
    authorUsername: string;
    authorId: string;
  };
};

export type MessageHandler = (context: MessageContext) => Promise<void>;

let messageHandler: MessageHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

// Direct trigger pattern - explicit mention of the bot
const DIRECT_TRIGGER = /\bbirmel\b/i;

// Confidence threshold for contextual classification
const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Determine if the bot should respond to a message.
 * Uses direct triggers first, then falls back to AI classification.
 */
async function shouldRespond(
  message: Message,
  clientId: string
): Promise<boolean> {
  // Ignore messages from bots
  if (message.author.bot) return false;

  // Direct trigger: bot is @mentioned
  if (message.mentions.has(clientId)) {
    logger.debug("Responding: direct mention");
    return true;
  }

  // Direct trigger: "birmel" keyword in message
  if (DIRECT_TRIGGER.test(message.content)) {
    logger.debug("Responding: birmel keyword");
    return true;
  }

  // Contextual classification: use AI to decide
  try {
    const recentMessages = await getRecentChannelMessages(message, 10);
    const formattedContext = formatMessagesForClassifier(
      recentMessages,
      message
    );

    const classifier = await getClassifierAgent();
    const result = await classifier.generate(formattedContext);

    const parseClassificationResult = await getParseClassificationResult();
    const classification = parseClassificationResult(result.text);

    logger.debug("Classification result", {
      shouldRespond: classification.shouldRespond,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
    });

    // Only respond if confident enough
    if (
      classification.shouldRespond &&
      classification.confidence >= CLASSIFICATION_CONFIDENCE_THRESHOLD
    ) {
      logger.debug("Responding: contextual classification", {
        confidence: classification.confidence,
      });
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Classification failed, defaulting to no response", error);
    return false;
  }
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

      const respond = await shouldRespond(message, client.user.id);
      if (!respond) {
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
        // Check if this message is a reply to another message
        let referencedMessage:
          | { content: string; authorUsername: string; authorId: string }
          | undefined;
        if (message.reference) {
          try {
            const ref = await message.fetchReference();
            referencedMessage = {
              content: ref.content,
              authorUsername: ref.author.username,
              authorId: ref.author.id,
            };
            logger.debug("Including referenced message context", {
              originalAuthor: ref.author.username,
              contentLength: ref.content.length,
            });
          } catch (error: unknown) {
            logger.warn("Failed to fetch referenced message", error);
            // Continue without the reference if fetching fails
          }
        }

        const context: MessageContext = {
          message,
          content: message.content,
          guildId: message.guild.id,
          channelId: message.channel.id,
          userId: message.author.id,
          username: message.author.username,
          ...(referencedMessage && { referencedMessage }),
        };

        await messageHandler(context);
      } catch (error: unknown) {
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
