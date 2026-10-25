import { PermissionFlagsBits, type Client } from "discord.js";
import type { ScheduleTarget } from "@shepherdjerred/streambot/sports/schedule-types.ts";
import type { WebDiscordContext } from "./web-context.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

export async function scheduledAuthority(input: {
  client: Client;
  web: WebDiscordContext;
  target: ScheduleTarget;
  excluded: ReadonlySet<string>;
}) {
  const { client, target, web, excluded } = input;
  if (!client.isReady()) throw new Error("Discord gateway is not ready");
  const guild = client.guilds.cache.get(target.guildId);
  const channel = guild?.channels.cache.get(target.channelId);
  if (
    guild === undefined ||
    channel?.isVoiceBased() !== true ||
    !channel.isSendable()
  )
    return { allowed: false, listeners: false };
  if (
    !(await web.webVerifyMember(
      GuildIdSchema.parse(target.guildId),
      target.userId,
    ))
  )
    return { allowed: false, listeners: false };
  const member = await guild.members.fetch(target.userId);
  const bot = await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
  ];
  const allowed =
    channel.permissionsFor(member).has(required) &&
    channel
      .permissionsFor(bot)
      .has([
        ...required,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.SendMessages,
      ]);
  return {
    allowed,
    listeners: channel.members.some((m) => !m.user.bot && !excluded.has(m.id)),
  };
}
