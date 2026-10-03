import { ChannelType, type Client } from "discord.js";
import {
  ChannelIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

/** Discord identity and live voice membership for the authenticated web transport. */
export class WebDiscordContext {
  constructor(private readonly client: Client) {}

  webApplicationId(): string {
    if (!this.client.isReady()) throw new Error("Discord gateway is not ready");
    return this.client.application.id;
  }

  webGuilds(ids: readonly string[]): { id: string; name: string }[] {
    return ids.flatMap((id) => {
      const guild = this.client.guilds.cache.get(id);
      return guild === undefined ? [] : [{ id: guild.id, name: guild.name }];
    });
  }

  async webVerifyMember(guildId: GuildId, userId: string): Promise<boolean> {
    if (!this.client.isReady()) throw new Error("Discord gateway is not ready");
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return false;
    try {
      await guild.members.fetch({ user: userId, force: true, cache: false });
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 10_007)
        return false;
      throw error;
    }
  }

  webVoiceChannel(
    guildId: GuildId,
    userId: string,
  ): { id: ChannelId; name: string } | null {
    if (!this.client.isReady()) throw new Error("Discord gateway is not ready");
    const guild = this.client.guilds.cache.get(guildId);
    const id = guild?.voiceStates.cache.get(userId)?.channelId;
    if (id === null || id === undefined) return null;
    const channel = guild?.channels.cache.get(id);
    return channel?.type === ChannelType.GuildVoice
      ? { id: ChannelIdSchema.parse(id), name: channel.name }
      : null;
  }

  webReady(): boolean {
    return this.client.isReady();
  }
}
