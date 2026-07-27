import { z } from "zod/v4";
import {
  DiscordApiMessageSchema,
  type DiscordApiMessage,
} from "#shared/glitter-corpus.ts";

const JsonRecordSchema = z.record(z.string(), z.unknown());

export function normalizeDiscordMessage(input: {
  message: DiscordApiMessage;
  guildId: string;
  guildSlug: string;
  sourceKey: string;
  observedAt: string;
}) {
  const message = DiscordApiMessageSchema.parse(input.message);
  return {
    schemaVersion: 1,
    source: "discord-rest",
    sourceKey: input.sourceKey,
    observedAt: input.observedAt,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: message.channel_id,
    messageId: message.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      globalName: message.author.global_name ?? null,
      discriminator: message.author.discriminator,
      bot: message.author.bot ?? false,
      avatar: message.author.avatar ?? null,
    },
    content: message.content,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp,
    type: message.type,
    flags: String(message.flags ?? 0),
    pinned: message.pinned,
    tts: message.tts,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.size,
      url: attachment.url,
      proxyUrl: attachment.proxy_url,
      contentType: attachment.content_type ?? null,
      height: attachment.height ?? null,
      width: attachment.width ?? null,
      description: attachment.description ?? null,
      ephemeral: attachment.ephemeral ?? false,
    })),
    referencedMessageId: message.message_reference?.message_id ?? null,
    raw: JsonRecordSchema.parse(message),
  };
}
