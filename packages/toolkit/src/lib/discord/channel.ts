import type { Client as UserClient } from "discord.js-selfbot-v13";
import { DaemonError } from "#lib/discord/error.ts";

export async function userChannelInfo(
  client: UserClient | null,
  channelId: string,
) {
  const user = client?.user;
  if (client === null || user == null)
    throw new DaemonError("User session is not ready");
  const channel = await client.channels.fetch(channelId);
  if (channel === null || !channel.isText() || !("guildId" in channel))
    throw new DaemonError("Guild text channels only");
  const permissions = channel.permissionsFor(user);
  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type,
    canView: permissions?.has("VIEW_CHANNEL") === true,
    canUseApplicationCommands:
      permissions?.has("USE_APPLICATION_COMMANDS") === true,
    canManageServer: permissions?.has("MANAGE_GUILD") === true,
    canManageMessages:
      permissions?.has("MANAGE_MESSAGES") === true &&
      (channel.guild.mfaLevel !== "ELEVATED" || user.mfaEnabled),
    moderationMfaLevel: channel.guild.mfaLevel,
    accountMfaEnabled: user.mfaEnabled,
    administrator: permissions?.has("ADMINISTRATOR") === true,
    memberPermissions: permissions?.bitfield.toString() ?? null,
    canSend:
      permissions?.has(
        channel.isThread() ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES",
      ) === true,
    slowmodeSeconds:
      "rateLimitPerUser" in channel ? channel.rateLimitPerUser : 0,
  };
}
