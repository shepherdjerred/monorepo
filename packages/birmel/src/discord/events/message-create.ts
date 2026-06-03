import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { Client, Message } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import {
  setSentryContext,
  clearSentryContext,
  captureException,
} from "@shepherdjerred/birmel/observability/sentry.ts";
import {
  extractImageAttachments,
  type ImageAttachment,
} from "@shepherdjerred/birmel/utils/image.ts";
import { recordMessageActivity } from "@shepherdjerred/birmel/database/repositories/activity.ts";
import { getOrCreateGuildOwner } from "@shepherdjerred/birmel/database/repositories/guild-owner.ts";
import { generateWakeWord } from "@shepherdjerred/birmel/config/constants.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import {
  markEngaged,
  isRecentlyEngaged,
} from "@shepherdjerred/birmel/discord/engagement-tracker.ts";
import { classifyShouldRespond } from "@shepherdjerred/birmel/voltagent/should-respond-classifier.ts";
import {
  getRecentChannelMessages,
  formatTranscript,
} from "@shepherdjerred/birmel/discord/utils/channel-history.ts";

// How many recent messages to show the should-respond classifier. Kept small
// and separate from the (larger) transcript the main agent receives — the
// classifier only needs enough context to judge whether the latest message is
// aimed at the bot.
const CLASSIFIER_TRANSCRIPT_LIMIT = 15;

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

// Allowed user IDs - only respond to messages from these users
const ALLOWED_USER_IDS = new Set([
  "186665676134547461", // Aaron
  "202595851678384137", // Brian
  "410595870380392458", // Irfan
  "200067001035653131", // Ryan
  "263577791105073152", // Danny
  "208425244128444418", // Virmel
  "251485022429642752", // Long
  "160509172704739328", // Jerred
  "171455587517857796", // Colin
  "331238905619677185", // Caitlyn
  "121887985896521732", // Richard
  "528096854831792159", // Hirza
  "208404668026454016", // Edward
  "175488352949108736", // Zach
  "138906561895464960", // Lisa
  "212824118670786560", // Dan
  "282716540053225472", // Joel
  "697028723257638922", // Chadwick
]);

/**
 * Determine if the bot should respond to a message.
 *
 * Direct triggers (@mention or dynamic wake word) always respond and mark the
 * channel "engaged". While a channel is engaged (the bot was talked to within
 * `responder.engagementWindowMs`), non-direct messages from allowed users are
 * passed to a cheap persona-aware classifier so the bot can follow a
 * conversation without being re-pinged each turn.
 */
async function shouldRespond(
  message: Message,
  clientId: string,
  guildId: string,
): Promise<boolean> {
  // Ignore messages from bots
  if (message.author.bot) {
    return false;
  }

  // Only respond to messages from allowed users
  if (!ALLOWED_USER_IDS.has(message.author.id)) {
    logger.debug("Ignoring message from non-allowed user", {
      userId: message.author.id,
      username: message.author.username,
    });
    return false;
  }

  const channelId = message.channel.id;

  // Direct trigger: bot is @mentioned
  if (message.mentions.has(clientId)) {
    logger.debug("Responding: direct mention");
    markEngaged(channelId);
    return true;
  }

  // Direct trigger: dynamic wake word based on current guild owner
  // e.g., if owner is "aaron", wake word is "baron"; if "virmel", it's "birmel"
  const guildOwner = await getOrCreateGuildOwner(guildId);
  const wakeWord = generateWakeWord(guildOwner.currentOwner);
  const wakeWordPattern = new RegExp(String.raw`\b${wakeWord}\b`, "i");

  if (wakeWordPattern.test(message.content)) {
    logger.debug("Responding: dynamic wake word", {
      wakeWord,
      owner: guildOwner.currentOwner,
    });
    markEngaged(channelId);
    return true;
  }

  // Conversational follow-up: only while the channel is actively engaged.
  const config = getConfig();
  if (
    config.responder.enabled &&
    isRecentlyEngaged(channelId, config.responder.engagementWindowMs)
  ) {
    const persona = await getGuildPersona(guildId);
    const recent = await getRecentChannelMessages(
      message,
      CLASSIFIER_TRANSCRIPT_LIMIT,
    );
    const respond = await classifyShouldRespond({
      persona,
      transcript: formatTranscript(recent),
      latestMessage: `${message.author.username}: ${message.content}`,
      guildId,
      channelId,
      userId: message.author.id,
    });
    if (respond) {
      logger.debug("Responding: classifier (engaged channel)", {
        channelId,
        persona,
      });
      // Extend the engagement window so the conversation can continue.
      markEngaged(channelId);
      return true;
    }
    return false;
  }

  // No trigger matched
  return false;
}

export function setupMessageCreateHandler(client: Client): void {
  client.on("messageCreate", (message: Message) => {
    void (async () => {
      // Only process guild messages for now
      if (message.guild == null) {
        return;
      }
      if (client.user == null) {
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
          const respond = await shouldRespond(message, clientUserId, guildId);
          span.setAttribute("should_respond", respond);

          if (!respond) {
            return;
          }

          // Deduplicate: prevent responding to the same message twice
          // This can happen during Discord gateway reconnections or network issues
          if (!markMessageProcessed(message.id)) {
            logger.debug("Skipping duplicate message", {
              messageId: message.id,
            });
            span.setAttribute("duplicate", true);
            return;
          }

          logger.debug("Processing message", {
            guildId,
            channelId: message.channel.id,
            userId: message.author.id,
            content: message.content.slice(0, 100),
          });

          if (messageHandler == null) {
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
          captureException(toError(error), {
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
