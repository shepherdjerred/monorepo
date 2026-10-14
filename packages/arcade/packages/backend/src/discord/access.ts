import {
  DiscordAPIError,
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import type { Player, SessionView } from "@arcade/common/catalog.ts";
import { humanPlayersInVoice } from "@discord-plays-pokemon/backend/webserver/play-policy.ts";
import type { DiscordAccess } from "#src/web/application.ts";
import { UserError } from "#src/errors.ts";

export class BotAccess implements DiscordAccess {
  constructor(
    private readonly bot: Client,
    private readonly excludedIds: ReadonlySet<string>,
  ) {}

  knownGuild(guildId: string): boolean {
    return this.bot.guilds.cache.has(guildId);
  }

  inVoice(
    session: Pick<SessionView, "guildId" | "voiceChannelId">,
    userId: string,
  ): boolean {
    return (
      this.bot.guilds.cache.get(session.guildId)?.voiceStates.cache.get(userId)
        ?.channelId === session.voiceChannelId
    );
  }

  players(session: Pick<SessionView, "guildId" | "voiceChannelId">): Player[] {
    const guild = this.bot.guilds.cache.get(session.guildId);
    return guild === undefined
      ? []
      : humanPlayersInVoice(
          guild.voiceStates.cache.values(),
          session.voiceChannelId,
          this.excludedIds,
        ).map((user) => ({
          discordId: user.discordId,
          name: user.name,
          avatarUrl: user.avatarUrl,
        }));
  }

  async moderator(guildId: string, userId: string): Promise<boolean> {
    const guild = this.bot.guilds.cache.get(guildId);
    if (guild === undefined) return false;
    const member = await memberOf(guild, userId);
    return member?.permissions.has(PermissionFlagsBits.ManageGuild) === true;
  }

  async servers(
    userId: string,
  ): Promise<{ id: string; name: string; voiceChannelName: string | null }[]> {
    const servers = await Promise.all(
      [...this.bot.guilds.cache.values()].map(async (guild) => {
        if ((await memberOf(guild, userId)) === undefined) return null;
        const voiceId = guild.voiceStates.cache.get(userId)?.channelId;
        return {
          id: guild.id,
          name: guild.name,
          voiceChannelName:
            voiceId === null || voiceId === undefined
              ? null
              : (guild.channels.cache.get(voiceId)?.name ?? null),
        };
      }),
    );
    return servers.filter((server) => server !== null);
  }

  async startTarget(
    guildId: string,
    userId: string,
  ): Promise<{ voiceChannelId: string; textChannelId: string }> {
    const guild = this.bot.guilds.cache.get(guildId);
    if (guild === undefined)
      throw new UserError(404, "Arcade is not in this server.");
    const voiceChannelId = guild.voiceStates.cache.get(userId)?.channelId;
    if (voiceChannelId === null || voiceChannelId === undefined)
      throw new UserError(403, "Join a voice channel before starting a game.");
    const voice = guild.channels.cache.get(voiceChannelId);
    if (voice?.type !== ChannelType.GuildVoice)
      throw new UserError(
        409,
        "Choose a regular voice channel to start Arcade.",
      );
    const me = await guild.members.fetchMe();
    if (!voice.permissionsFor(me).has(PermissionFlagsBits.ViewChannel))
      throw new UserError(403, "Arcade needs access to your voice channel.");
    for (const candidate of [voice, guild.systemChannel]) {
      if (
        candidate?.isSendable() === true &&
        candidate
          .permissionsFor(me)
          .has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
          ])
      )
        return { voiceChannelId, textChannelId: candidate.id };
    }
    throw new UserError(
      403,
      "Arcade needs a writable voice chat or server system channel for game notifications.",
    );
  }
}

async function memberOf(
  guild: Guild,
  userId: string,
): Promise<GuildMember | undefined> {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10_007)
      return undefined;
    throw error;
  }
}
