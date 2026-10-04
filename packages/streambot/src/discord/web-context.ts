import { ChannelType } from "discord.js";
import { z } from "zod";
import {
  ChannelIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

export type WebDiscordClient = {
  isReady: () => boolean;
  application: { id: string } | null;
  guilds: {
    cache: ReadonlyMap<
      string,
      {
        id: string;
        name: string;
        members: {
          cache?: ReadonlyMap<string, { displayName: string }>;
          fetch: (options: {
            user: string;
            force: true;
            cache: false;
          }) => Promise<unknown>;
        };
        voiceStates: {
          cache: ReadonlyMap<string, { channelId: string | null }>;
        };
        channels: {
          cache: ReadonlyMap<string, { type: ChannelType; name: string }>;
        };
      }
    >;
  };
};

/** Discord identity and live voice membership for the authenticated web transport. */
export class WebDiscordContext {
  private readonly names = new Map<
    string,
    { expires: number; name: Promise<string> }
  >();
  private readonly memberships = new Map<string, Promise<boolean>>();
  constructor(private readonly client: WebDiscordClient) {}

  webApplicationId(): string {
    if (!this.client.isReady() || this.client.application === null)
      throw new Error("Discord gateway is not ready");
    return this.client.application.id;
  }

  async webRequesterName(guildId: string, userId: string): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return "Former member";
    const cached = guild.members.cache?.get(userId);
    if (cached !== undefined) return cached.displayName;
    const key = guildId + ":" + userId;
    const existing = this.names.get(key);
    if (existing !== undefined && existing.expires > Date.now())
      return await existing.name;
    if (this.names.size >= 2000) {
      const oldest = this.names.keys().next().value;
      if (oldest !== undefined) this.names.delete(oldest);
    }
    const name = (async () => {
      try {
        return z.object({ displayName: z.string() }).parse(
          await guild.members.fetch({
            user: userId,
            force: true,
            cache: false,
          }),
        ).displayName;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === 10_007)
          return "Former member";
        throw error;
      }
    })();
    this.names.set(key, { expires: Date.now() + 300_000, name });
    try {
      return await name;
    } catch (error) {
      if (this.names.get(key)?.name === name) this.names.delete(key);
      throw error;
    }
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
    const key = `${guildId}:${userId}`;
    const existing = this.memberships.get(key);
    if (existing !== undefined) return await existing;
    if (this.memberships.size >= 2000 && !this.memberships.has(key)) {
      const oldest = this.memberships.keys().next().value;
      if (oldest !== undefined) this.memberships.delete(oldest);
    }
    const pending = (async () => {
      try {
        await guild.members.fetch({ user: userId, force: true, cache: false });
        return true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === 10_007)
          return false;
        throw error;
      }
    })();
    this.memberships.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.memberships.get(key) === pending) this.memberships.delete(key);
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
