import type { APIEmbed, MessageCreateOptions } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import {
  describeChannelResolutionFailure,
  resolveSendableChannel,
} from "@shepherdjerred/birmel/agent-tools/tools/discord/channel-resolver.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

export async function sendMusicEmbed(
  embed: APIEmbed,
  explicitChannelId?: string,
): Promise<void> {
  const requestContext = getRequestContext();
  const channelId = explicitChannelId ?? requestContext?.sourceChannelId;
  if (channelId == null || channelId.length === 0) {
    return;
  }

  const client = getDiscordClient();
  const resolution = await resolveSendableChannel(client, channelId);
  if (resolution.kind !== "ok") {
    logger.warn("Could not send music embed", {
      channelId,
      reason: describeChannelResolutionFailure(resolution, channelId),
    });
    return;
  }

  const payload: MessageCreateOptions = { embeds: [embed] };
  await resolution.channel.send(payload);
}
