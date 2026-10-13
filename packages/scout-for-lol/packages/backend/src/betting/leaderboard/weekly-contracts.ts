import type { MessageCreateOptions } from "discord.js";
import type {
  BucksWeeklyLeaderboardEntries,
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/data";
import type { FullLeaderboardRow } from "#src/betting/accounts.ts";
import type { WeeklyBucksStats } from "#src/betting/leaderboard/weekly-format.ts";

export type WeeklyBucksLeaderboardDependencies = {
  enabledGuilds: () => Promise<DiscordGuildId[]>;
  hasGuild: (serverId: DiscordGuildId) => Promise<boolean>;
  loadRows: (serverId: DiscordGuildId) => Promise<FullLeaderboardRow[]>;
  loadStats: (
    serverId: DiscordGuildId,
    windowStart: Date,
  ) => Promise<WeeklyBucksStats>;
  persistSnapshot: (input: {
    serverId: DiscordGuildId;
    runWeek: number;
    entries: BucksWeeklyLeaderboardEntries;
  }) => Promise<void>;
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    serverId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

export type WeeklyBucksLeaderboardResult = {
  status: "sent" | "not_in_guild" | "queued" | "paused";
  entryCount: number;
  chunkCount: number;
};
