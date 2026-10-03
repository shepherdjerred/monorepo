import { ChannelType } from "discord.js";
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
  on: (
    event: "guildMemberRemove",
    listener: (member: { guild: { id: string }; id: string }) => void,
  ) => unknown;
};

/** Discord identity and live voice membership for the authenticated web transport. */
export class WebDiscordContext {
  private readonly memberships = new Map<
    string,
    { promise: Promise<boolean>; expires: number; pending: boolean }
  >();
  constructor(private readonly client: WebDiscordClient) {
    client.on("guildMemberRemove", (member) => {
      this.memberships.delete(`${member.guild.id}:${member.id}`);
    });
  }

  webApplicationId(): string {
    if (!this.client.isReady() || this.client.application === null)
      throw new Error("Discord gateway is not ready");
    return this.client.application.id;
  }

  webGuilds(ids: readonly string[]): { id: string; name: string }[] {
    return ids.flatMap((id) => {
      const guild = this.client.guilds.cache.get(id);
      return guild === undefined ? [] : [{ id: guild.id, name: guild.name }];
    });
  }

  async webVerifyMember(
    guildId: GuildId,
    userId: string,
    fresh = false,
  ): Promise<boolean> {
    if (!this.client.isReady()) throw new Error("Discord gateway is not ready");
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return false;
    const key = `${guildId}:${userId}`;
    const existing = this.memberships.get(key);
    if (
      existing !== undefined &&
      (existing.pending || (!fresh && existing.expires > Date.now()))
    )
      return await existing.promise;
    for (const [cachedKey, entry] of this.memberships)
      if (!entry.pending && entry.expires <= Date.now())
        this.memberships.delete(cachedKey);
    if (this.memberships.size >= 2000 && !this.memberships.has(key)) {
      const oldest = this.memberships.keys().next().value;
      if (oldest !== undefined) this.memberships.delete(oldest);
    }
    const entry = {
      promise: Promise.resolve(false),
      expires: 0,
      pending: true,
    };
    this.memberships.set(key, entry);
    entry.promise = (async () => {
      try {
        await guild.members.fetch({ user: userId, force: true, cache: false });
        // A gateway removal during the REST request invalidates its result too.
        if (this.memberships.get(key) !== entry) return false;
        entry.pending = false;
        entry.expires = Date.now() + 5000;
        return true;
      } catch (error) {
        if (this.memberships.get(key) === entry) this.memberships.delete(key);
        if (error instanceof Error && "code" in error && error.code === 10_007)
          return false;
        throw error;
      }
    })();
    return await entry.promise;
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
