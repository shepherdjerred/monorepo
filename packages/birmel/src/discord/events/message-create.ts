import type { Client, Message } from "discord.js";
import {
  TurnInputSchema,
  type TriggerKind,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { generateWakeWord } from "@shepherdjerred/birmel/config/constants.ts";
import { recordMessageActivity } from "@shepherdjerred/birmel/database/repositories/activity.ts";
import { getOrCreateGuildOwner } from "@shepherdjerred/birmel/database/repositories/guild-owner.ts";
import {
  isRecentlyEngaged,
  markEngaged,
} from "@shepherdjerred/birmel/discord/engagement-tracker.ts";
import { classifyShouldRespond } from "@shepherdjerred/birmel/discord/should-respond-classifier.ts";
import {
  formatTranscript,
  getRecentChannelMessages,
} from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import { getActiveSessionForThread } from "@shepherdjerred/birmel/sessions/service.ts";
import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { extractImageAttachments } from "@shepherdjerred/birmel/utils/image.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const CLASSIFIER_TRANSCRIPT_LIMIT = 15;
const logger = loggers.discord.child("message-create");

export type MessageContext = {
  message: Message;
  turn: TurnInput;
  activeSessionId?: string;
};

export type MessageHandler = (context: MessageContext) => Promise<void>;

let messageHandler: MessageHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

async function admissionDecision(
  message: Message,
  clientId: string,
  guildId: string,
): Promise<{ triggerKind: TriggerKind; activeSessionId?: string } | null> {
  const config = getConfig();
  if (
    message.author.bot ||
    !config.authority.trustedUserIds.includes(message.author.id)
  ) {
    return null;
  }

  if (message.channel.isThread()) {
    const session = await getActiveSessionForThread(message.channel.id);
    if (session != null) {
      return { triggerKind: "session-thread", activeSessionId: session.id };
    }
  }
  if (message.mentions.has(clientId)) {
    markEngaged(message.channel.id);
    return { triggerKind: "mention" };
  }

  const owner = await getOrCreateGuildOwner(guildId);
  const wakeWord = generateWakeWord(owner.currentOwner);
  const pattern = new RegExp(String.raw`\b${wakeWord}\b`, "i");
  if (pattern.test(message.content)) {
    markEngaged(message.channel.id);
    return { triggerKind: "wake-word" };
  }

  if (
    !config.responder.enabled ||
    !isRecentlyEngaged(message.channel.id, config.responder.engagementWindowMs)
  ) {
    return null;
  }
  const persona = await getGuildPersona(guildId);
  const recent = await getRecentChannelMessages(
    message,
    CLASSIFIER_TRANSCRIPT_LIMIT,
  );
  const shouldRespond = await classifyShouldRespond({
    persona,
    transcript: formatTranscript(recent),
    latestMessage: `${message.author.username}: ${message.content}`,
    guildId,
    channelId: message.channel.id,
    userId: message.author.id,
  });
  if (!shouldRespond) {
    return null;
  }
  markEngaged(message.channel.id);
  return { triggerKind: "engaged-follow-up" };
}

function toTurnInput(
  message: Message,
  guildId: string,
  decision: { triggerKind: TriggerKind },
): TurnInput {
  const images = extractImageAttachments(message);
  return TurnInputSchema.parse({
    discordMessageId: message.id,
    guildId,
    channelId: message.channel.id,
    ...(message.channel.isThread() ? { threadId: message.channel.id } : {}),
    userId: message.author.id,
    username: message.author.username,
    content: message.content,
    attachments: images.map((image) => ({
      id: image.id,
      url: image.url,
      contentType: image.contentType,
      name: image.filename,
    })),
    ...(message.member?.voice.channelId == null
      ? {}
      : { voiceChannelId: message.member.voice.channelId }),
    triggerKind: decision.triggerKind,
    receivedAt: message.createdAt,
  });
}

export function setupMessageCreateHandler(client: Client): void {
  client.on("messageCreate", (message: Message) => {
    void (async () => {
      if (message.guild == null || client.user == null) {
        return;
      }
      const guildId = message.guild.id;
      if (!message.author.bot) {
        recordMessageActivity({
          guildId,
          userId: message.author.id,
          channelId: message.channel.id,
          messageId: message.id,
          characterCount: message.content.length,
        });
      }

      await withSpan(
        "birmel.admission",
        {
          guildId,
          channelId: message.channel.id,
          userId: message.author.id,
          messageId: message.id,
        },
        async (span) => {
          try {
            const decision = await admissionDecision(
              message,
              client.user?.id ?? "",
              guildId,
            );
            span.setAttribute("birmel.admission.accepted", decision != null);
            logger.debug("Discord admission evaluated", {
              guildId,
              channelId: message.channel.id,
              messageId: message.id,
              accepted: decision != null,
              triggerKind: decision?.triggerKind ?? "none",
            });
            if (decision == null) {
              return;
            }
            span.setAttribute("birmel.trigger_kind", decision.triggerKind);
            if (messageHandler == null) {
              throw new Error("No Birmel message handler is registered");
            }
            await messageHandler({
              message,
              turn: toTurnInput(message, guildId, decision),
              ...(decision.activeSessionId == null
                ? {}
                : { activeSessionId: decision.activeSessionId }),
            });
          } catch (error) {
            logger.error("Message admission or dispatch failed", error, {
              guildId,
              channelId: message.channel.id,
              messageId: message.id,
              errorClass: error instanceof Error ? error.name : "UnknownError",
            });
            captureException(toError(error), {
              operation: "messageCreate",
              discord: {
                guildId,
                channelId: message.channel.id,
                userId: message.author.id,
                messageId: message.id,
              },
            });
          }
        },
      );
    })();
  });
}
