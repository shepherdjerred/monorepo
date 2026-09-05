import type { EnvLookup } from "@shepherdjerred/streambot/config/index.ts";
import type { VoiceHandle } from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserTokenSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

export const STREAMER_USER_TOKEN = UserTokenSchema.parse("user-token");

export const STREAMER_VOICE: VoiceHandle = {
  guildId: GuildIdSchema.parse("100000000000000010"),
  channelId: ChannelIdSchema.parse("100000000000000020"),
};

export function streamerEnv(over: EnvLookup = {}): EnvLookup {
  return {
    BOT_TOKEN: "bot-token",
    USER_TOKENS: "user-token",
    VIDEOS_DIR: "/videos",
    ...over,
  };
}
