import { REST, Routes } from "discord.js";
import { z } from "zod";
import {
  DiscordChannelIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";

let rest: REST | undefined;

/** Application-role replies use the bot token over REST, without a gateway. */
export async function deliverSupportReply(
  userId: DiscordAccountId,
  content: string,
): Promise<void> {
  rest ??= new REST({ retries: 0, timeout: 5000 }).setToken(
    configuration.discordToken,
  );
  const channel = z.object({ id: DiscordChannelIdSchema }).parse(
    await rest.post(Routes.userChannels(), {
      body: { recipient_id: userId },
    }),
  );
  await rest.post(Routes.channelMessages(channel.id), {
    body: { content, allowed_mentions: { parse: [] } },
  });
}
