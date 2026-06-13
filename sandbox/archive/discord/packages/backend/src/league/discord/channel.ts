import { MessageCreateOptions, MessagePayload } from "npm:discord.js@14.14.1";
import configuration from "../../configuration.ts";
import client from "../../discord/client.ts";

export async function send(
  options: string | MessagePayload | MessageCreateOptions,
) {
  const channel = await client.channels.fetch(configuration.leagueChannelId);
  if (!channel?.isTextBased()) {
    throw new Error("invalid channel");
  }
  return channel.send(options);
}
