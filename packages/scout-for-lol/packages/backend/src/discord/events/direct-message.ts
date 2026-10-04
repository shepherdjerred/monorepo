import { ChannelType, type Message } from "discord.js";
import { TRPCError } from "@trpc/server";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import { acceptSupportMessage } from "#src/support/conversations.ts";
import { DiscordScreenshotSchema } from "#src/support/screenshots.ts";
import { wakeSupportJobs } from "#src/support/jobs.ts";
import { claimSupportFailureNotice } from "#src/support/sender-throttle.ts";

type SupportMessage = Pick<
  Message,
  | "id"
  | "author"
  | "channel"
  | "channelId"
  | "content"
  | "attachments"
  | "createdAt"
  | "client"
>;
export async function handleSupportDirectMessage(
  message: SupportMessage,
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  if (message.channel.type !== ChannelType.DM || message.author.bot) return;
  if (message.content.trim().length === 0 && message.attachments.size === 0)
    return;
  const userId = DiscordAccountIdSchema.parse(message.author.id);
  const failureNotice = async (text: string) => {
    if (!(await claimSupportFailureNotice(db, userId))) return;
    await sendDM({
      client: message.client,
      prisma: db,
      userId,
      kind: "support_acknowledgement",
      message: text,
      suppressMentions: true,
    });
  };
  if (message.content.length > 4000) {
    await failureNotice(
      "Your message was not saved: please keep each message under 4,000 characters.",
    );
    return;
  }
  const { screenshots, rejectedFile } = supportAttachments(message);
  if (message.content.trim().length === 0 && screenshots.length === 0) {
    await failureNotice(
      "Nothing was saved. Send a message, or up to five PNG, JPEG, or WebP screenshots of 10 MiB or less each.",
    );
    return;
  }
  try {
    const saved = await acceptSupportMessage(
      {
        discordId: userId,
        username: message.author.username,
        body: message.content,
        createdAt: message.createdAt,
        source: "DISCORD_DM",
        discordMessageId: message.id,
        discordChannelId: message.channelId,
        discordAttachments: screenshots,
      },
      db,
    );
    if (!saved.inserted) return;
  } catch (error) {
    if (error instanceof TRPCError) {
      await failureNotice(`Your message was not saved: ${error.message}`);
      return;
    }
    await failureNotice(
      `I couldn't save your message to Scout's support inbox. Please resend it in a moment, or try ${getFeedbackUrl()}`,
    );
    throw error;
  }
  if (rejectedFile)
    await failureNotice(
      "Your message and supported screenshots were saved, but some attachments were not. Send up to five PNG, JPEG, or WebP screenshots of 10 MiB or less each.",
    );
  await wakeSupportJobs();
}

function attachmentContentType(attachment: {
  contentType: string | null;
  name: string;
}): string {
  if (attachment.contentType !== null) return attachment.contentType;
  const name = attachment.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return /\.jpe?g$/i.test(name) ? "image/jpeg" : "unsupported";
}

function supportAttachments(message: SupportMessage) {
  const screenshots: ReturnType<typeof DiscordScreenshotSchema.parse>[] = [];
  let rejectedFile = false;
  for (const attachment of message.attachments.values()) {
    const file = DiscordScreenshotSchema.safeParse({
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
      contentType: attachmentContentType(attachment),
    });
    if (!file.success || screenshots.length >= 5) rejectedFile = true;
    else screenshots.push(file.data);
  }

  return { screenshots, rejectedFile };
}
