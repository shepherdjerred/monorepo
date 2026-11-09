import { z } from "zod";
import type { Client as UserClient } from "discord.js-selfbot-v13";
import { DaemonError } from "#lib/discord/error.ts";

export const DeleteReplyRequestSchema = z.strictObject({
  guildId: z.string().regex(/^\d+$/),
  channelId: z.string().regex(/^\d+$/),
  messageId: z.string().regex(/^\d+$/),
  expectedAuthorId: z.string().regex(/^\d+$/),
});
const MissingMessage = z.union([
  z.object({ code: z.literal(10_008) }),
  // The user SDK reports absence after a fresh around-ID channel fetch.
  z.object({ message: z.literal("MESSAGE_ID_NOT_FOUND") }),
]);

/** Delete one pinned bot reply, checking remote identity before mutation. */
export async function deleteDiscordReply(input: {
  request: z.infer<typeof DeleteReplyRequestSchema>;
  read: () => Promise<{
    id: string;
    guildId: string | null;
    channelId: string;
    authorId: string;
    authorIsBot: boolean;
  }>;
  remove: () => Promise<void>;
}) {
  const read = async () => {
    try {
      return await input.read();
    } catch (error) {
      if (MissingMessage.safeParse(error).success) return null;
      throw error;
    }
  };
  const message = await read();
  if (message === null) return { deleted: true, alreadyAbsent: true };
  const expected = input.request;
  if (
    message.id !== expected.messageId ||
    message.channelId !== expected.channelId ||
    message.guildId !== expected.guildId ||
    message.authorId !== expected.expectedAuthorId ||
    !message.authorIsBot
  )
    throw new Error(
      "Reply identity does not match the exact authorized bot/guild/channel/message",
    );
  await input.remove();
  if ((await read()) !== null)
    throw new Error("Reply deletion has no confirmed remote readback");
  return { deleted: true, alreadyAbsent: false };
}

export async function handleDeleteReply(
  user: UserClient | null,
  body: unknown,
) {
  const request = DeleteReplyRequestSchema.parse(body);
  if (user === null)
    throw new DaemonError("Reply cleanup requires a user identity");
  const channel = await user.channels.fetch(request.channelId);
  if (channel?.isText() !== true)
    throw new DaemonError("Reply cleanup requires the assigned text channel");
  return await deleteDiscordReply({
    request,
    read: async () => {
      const message = await channel.messages.fetch(request.messageId, {
        cache: false,
        force: true,
      });
      return {
        id: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
      };
    },
    remove: async () => {
      await channel.messages.delete(request.messageId);
    },
  });
}
