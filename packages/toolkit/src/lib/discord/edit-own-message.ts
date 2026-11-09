import { z } from "zod";
import type { Client as UserClient } from "discord.js-selfbot-v13";
import { DaemonError } from "#lib/discord/error.ts";

const RequestSchema = z.strictObject({
  guildId: z.string().regex(/^\d+$/),
  channelId: z.string().regex(/^\d+$/),
  messageId: z.string().regex(/^\d+$/),
  expectedAuthorId: z.string().regex(/^\d+$/),
  content: z.string().min(1).max(2000),
});
type Message = {
  id: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  content: string;
};

/** Correct one existing user message; identity is checked before any write. */
export async function editOwnDiscordMessage(input: {
  request: z.infer<typeof RequestSchema>;
  selfId: string;
  read: () => Promise<Message>;
  edit: (content: string) => Promise<void>;
}) {
  const request = RequestSchema.parse(input.request);
  const matches = (message: Message) =>
    message.id === request.messageId &&
    message.guildId === request.guildId &&
    message.channelId === request.channelId &&
    message.authorId === request.expectedAuthorId &&
    message.authorId === input.selfId;
  const before = await input.read();
  if (!matches(before))
    throw new Error("Message identity mismatch; no edit sent");
  if (before.content === request.content)
    return { edited: true, alreadyMatched: true, messageId: before.id };
  await input.edit(request.content);
  const after = await input.read();
  if (!matches(after) || after.content !== request.content)
    throw new Error(
      "Message edit has no matching fresh readback; do not repeat",
    );
  return { edited: true, alreadyMatched: false, messageId: after.id };
}

export async function handleEditOwnMessage(
  user: UserClient | null,
  body: unknown,
) {
  const request = RequestSchema.parse(body);
  if (user?.user == null)
    throw new DaemonError("User session required for editing");
  const channel = await user.channels.fetch(request.channelId);
  if (channel?.isText() !== true)
    throw new DaemonError("Assigned text channel required for editing");
  let message = await channel.messages.fetch(request.messageId, {
    cache: false,
    force: true,
  });
  return await editOwnDiscordMessage({
    request,
    selfId: user.user.id,
    read: async () => {
      message = await channel.messages.fetch(request.messageId, {
        cache: false,
        force: true,
      });
      return {
        id: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        authorId: message.author.id,
        content: message.content,
      };
    },
    edit: async (content) => {
      await message.edit(content);
    },
  });
}
