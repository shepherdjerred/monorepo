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
import { listActivePersonaAliases } from "@shepherdjerred/birmel/memory/aliases.ts";
import { getActiveSessionForThread } from "@shepherdjerred/birmel/sessions/service.ts";
import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { extractImageAttachments } from "@shepherdjerred/birmel/utils/image.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const CLASSIFIER_TRANSCRIPT_LIMIT = 15;
const MAX_PENDING_ADMISSIONS_PER_CHANNEL = 25;
const logger = loggers.discord.child("message-create");
const UNICODE_WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const channelAdmissionQueues = new Map<string, (() => Promise<void>)[]>();

function containsWakeWord(content: string, wakeWord: string): boolean {
  const normalizedContent = content
    .normalize("NFKC")
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
  const normalizedWakeWord = wakeWord
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
  let index = normalizedContent.indexOf(normalizedWakeWord);
  while (index !== -1) {
    const before = normalizedContent[index - 1];
    const after = normalizedContent[index + normalizedWakeWord.length];
    if (
      (before === undefined || !UNICODE_WORD_CHARACTER.test(before)) &&
      (after === undefined || !UNICODE_WORD_CHARACTER.test(after))
    ) {
      return true;
    }
    index = normalizedContent.indexOf(
      normalizedWakeWord,
      index + normalizedWakeWord.length,
    );
  }
  return false;
}

async function drainChannelAdmissionQueue(
  channelId: string,
  queue: (() => Promise<void>)[],
): Promise<void> {
  while (queue.length > 0) {
    const operation = queue.shift();
    if (operation == null) {
      throw new Error("Channel admission queue lost its next operation");
    }
    try {
      await operation();
    } catch (error) {
      logger.error("Queued message admission failed", error, { channelId });
    }
  }
  channelAdmissionQueues.delete(channelId);
}

function enqueueChannelAdmission(
  channelId: string,
  messageId: string,
  operation: () => Promise<void>,
): void {
  const queue = channelAdmissionQueues.get(channelId);
  if (queue != null) {
    if (queue.length >= MAX_PENDING_ADMISSIONS_PER_CHANNEL) {
      logger.warn("Channel admission queue is full; dropping message", {
        channelId,
        messageId,
        pendingCount: queue.length,
      });
      return;
    }
    queue.push(operation);
    return;
  }
  const newQueue = [operation];
  channelAdmissionQueues.set(channelId, newQueue);
  void drainChannelAdmissionQueue(channelId, newQueue);
}

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
  if (message.mentions.repliedUser?.id === clientId) {
    markEngaged(message.channel.id);
    return { triggerKind: "reply" };
  }

  const owner = await getOrCreateGuildOwner(guildId);
  const wakeWord = generateWakeWord(owner.currentOwner);
  if (containsWakeWord(message.content, wakeWord)) {
    markEngaged(message.channel.id);
    return { triggerKind: "wake-word" };
  }

  const persona = await getGuildPersona(guildId);
  const acceptedAliases = await listActivePersonaAliases({
    guildId,
    personaId: persona,
  });
  if (
    acceptedAliases.some((alias) => containsWakeWord(message.content, alias))
  ) {
    markEngaged(message.channel.id);
    return { triggerKind: "learned-alias" };
  }

  if (
    !config.responder.enabled ||
    !isRecentlyEngaged(message.channel.id, config.responder.engagementWindowMs)
  ) {
    return null;
  }
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

function reportMessageFailure(options: {
  message: Message;
  guildId: string;
  phase: "prepare" | "admission" | "dispatch";
  error: unknown;
}): void {
  const errorClass =
    options.error instanceof Error ? options.error.name : "UnknownError";
  logger.error(`Message ${options.phase} failed`, options.error, {
    guildId: options.guildId,
    channelId: options.message.channel.id,
    messageId: options.message.id,
    errorClass,
  });
  captureException(toError(options.error), {
    operation: `messageCreate.${options.phase}`,
    discord: {
      guildId: options.guildId,
      channelId: options.message.channel.id,
      userId: options.message.author.id,
      messageId: options.message.id,
    },
  });
}

async function dispatchAcceptedMessage(
  context: MessageContext,
  guildId: string,
): Promise<void> {
  try {
    if (messageHandler == null) {
      throw new Error("No Birmel message handler is registered");
    }
    await messageHandler(context);
  } catch (error) {
    reportMessageFailure({
      message: context.message,
      guildId,
      phase: "dispatch",
      error,
    });
  }
}

async function processMessageAdmission(
  message: Message,
  clientId: string,
  guildId: string,
): Promise<void> {
  try {
    await withSpan(
      "birmel.admission",
      {
        guildId,
        channelId: message.channel.id,
        userId: message.author.id,
        messageId: message.id,
      },
      async (span) => {
        const decision = await admissionDecision(message, clientId, guildId);
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
        const context: MessageContext = {
          message,
          turn: toTurnInput(message, guildId, decision),
          ...(decision.activeSessionId == null
            ? {}
            : { activeSessionId: decision.activeSessionId }),
        };
        void dispatchAcceptedMessage(context, guildId);
      },
    );
  } catch (error) {
    reportMessageFailure({ message, guildId, phase: "admission", error });
  }
}

export function setupMessageCreateHandler(client: Client): void {
  client.on("messageCreate", (message: Message) => {
    if (message.guild == null || client.user == null) {
      return;
    }
    const guildId = message.guild.id;
    const clientId = client.user.id;
    try {
      if (message.author.bot) {
        return;
      }
      recordMessageActivity({
        guildId,
        userId: message.author.id,
        channelId: message.channel.id,
        messageId: message.id,
        characterCount: message.content.length,
      });
      if (!getConfig().authority.trustedUserIds.includes(message.author.id)) {
        return;
      }
      enqueueChannelAdmission(message.channel.id, message.id, async () => {
        await processMessageAdmission(message, clientId, guildId);
      });
    } catch (error) {
      reportMessageFailure({ message, guildId, phase: "prepare", error });
    }
  });
}
