import type { Client, Message } from "discord.js";
import type { getClassifierAgent as GetClassifierAgentFn } from "../../mastra/index.js";
import type { parseClassificationResult as ParseClassificationResultFn } from "../../mastra/agents/classifier-agent.js";
import { loggers } from "../../utils/logger.js";
import {
  getRecentChannelMessages,
  formatMessagesForClassifier,
} from "../utils/channel-history.js";
import {
  withSpan,
  setSentryContext,
  clearSentryContext,
  captureException,
} from "../../observability/index.js";
import {
  extractImageAttachments,
  type ImageAttachment,
} from "../../utils/image.js";
import { recordMessageActivity } from "../../database/repositories/activity.js";

const logger = loggers.discord.child("message-create");

// Message deduplication to prevent duplicate responses
// This handles cases where Discord sends duplicate messageCreate events
// (e.g., during gateway reconnection or network issues)
const processedMessages = new Set<string>();
const PROCESSED_MESSAGE_TTL = 60_000; // 1 minute TTL

function markMessageProcessed(messageId: string): boolean {
  if (processedMessages.has(messageId)) {
    return false; // Already processed
  }
  processedMessages.add(messageId);
  // Clean up after TTL to prevent memory leaks
  setTimeout(() => {
    processedMessages.delete(messageId);
  }, PROCESSED_MESSAGE_TTL);
  return true; // Successfully marked as processing
}

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

export type { ImageAttachment };

export type MessageContext = {
  message: Message;
  content: string;
  attachments: ImageAttachment[];
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

// Direct trigger pattern - explicit mention of the bot
const DIRECT_TRIGGER = /\bbirmel\b/i;

// Confidence threshold for contextual classification
const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.7;

// Allowed user IDs - only respond to messages from these users
const ALLOWED_USER_IDS = new Set([
  "171455587517857796", // Colin
]);

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

  // Only respond to messages from allowed users
  if (!ALLOWED_USER_IDS.has(message.author.id)) {
    logger.debug("Ignoring message from non-allowed user", {
      userId: message.author.id,
      username: message.author.username,
    });
    return false;
  }

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
  const discordContext = {
    ...(message.guild?.id ? { guildId: message.guild.id } : {}),
    channelId: message.channel.id,
    userId: message.author.id,
    messageId: message.id,
  };

  try {
    return await withSpan("classifier.decide", discordContext, async (span) => {
      const recentMessages = await getRecentChannelMessages(message, 10);
      span.setAttribute("context.message_count", recentMessages.length);

      const formattedContext = formatMessagesForClassifier(
        recentMessages,
        message
      );

      const classifier = await getClassifierAgent();
      const result = await classifier.generate(formattedContext);

      const parseClassificationResult = await getParseClassificationResult();
      const classification = parseClassificationResult(result.text);

      span.setAttribute("classification.should_respond", classification.shouldRespond);
      span.setAttribute("classification.confidence", classification.confidence);

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
    });
  } catch (error) {
    logger.error("Classification failed, defaulting to no response", error);
    captureException(error as Error, {
      operation: "shouldRespond.classification",
      discord: {
        ...(message.guild?.id ? { guildId: message.guild.id } : {}),
        channelId: message.channel.id,
        userId: message.author.id,
        messageId: message.id,
      },
    });
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

      // Store non-null values for use in async callbacks
      const clientUserId = client.user.id;
      const guildId = message.guild.id;

      const discordContext = {
        guildId,
        channelId: message.channel.id,
        userId: message.author.id,
        username: message.author.username,
        messageId: message.id,
      };

      // Record message activity for non-bot messages
      if (!message.author.bot) {
        recordMessageActivity({
          guildId: message.guild.id,
          userId: message.author.id,
          channelId: message.channel.id,
          messageId: message.id,
          characterCount: message.content.length,
        });
      }

      await withSpan("discord.messageCreate", discordContext, async (span) => {
        setSentryContext(discordContext);

        try {
          const respond = await shouldRespond(message, clientUserId);
          span.setAttribute("should_respond", respond);

          if (!respond) {
            return;
          }

          // Deduplicate: prevent responding to the same message twice
          // This can happen during Discord gateway reconnections or network issues
          if (!markMessageProcessed(message.id)) {
            logger.debug("Skipping duplicate message", { messageId: message.id });
            span.setAttribute("duplicate", true);
            return;
          }

          logger.debug("Processing message", {
            guildId,
            channelId: message.channel.id,
            userId: message.author.id,
            content: message.content.slice(0, 100),
          });

          if (!messageHandler) {
            logger.warn("No message handler registered");
            return;
          }

          await messageHandler({
            message,
            content: message.content,
            attachments: extractImageAttachments(message),
            guildId,
            channelId: message.channel.id,
            userId: message.author.id,
            username: message.author.username,
          });
        } catch (error) {
          logger.error("Error handling message", error);
          captureException(error as Error, {
            operation: "messageCreate",
            discord: discordContext,
          });
          try {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            await message.reply(
              `Sorry, I encountered an error processing your request.\n\`\`\`\n${errorMessage}\n\`\`\``,
            );
          } catch {
            // Ignore reply errors
          }
        } finally {
          clearSentryContext();
        }
      });
    })();
  });
}
