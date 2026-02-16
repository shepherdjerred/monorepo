import type { AccountId, DiscordAccountId, LeaguePuuid, PlayerId, Rank, Region } from "@scout-for-lol/data";

/**
 * Player with their accounts from Prisma
 * This is what we get from fetching participants with their accounts
 */
export type PlayerWithAccounts = {
  id: PlayerId;
  alias: string;
  discordId: DiscordAccountId | null;
  accounts: {
    id: AccountId;
    alias: string;
    puuid: LeaguePuuid;
    region: Region;
  }[];
};

/**
 * Leaderboard entry returned by processors
 */
export type LeaderboardEntry = {
  playerId: PlayerId;
  playerName: string;
  score: number | Rank;
  metadata?: Record<string, unknown>;
  /** Discord ID of the player, if linked. Used for highlighting user position in embeds. */
  discordId?: DiscordAccountId | null;
};
