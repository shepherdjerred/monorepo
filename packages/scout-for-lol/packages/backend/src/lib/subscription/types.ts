import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data/index.ts";
import type { ResolvedDiscordUser } from "#src/lib/discord/resolve-users.ts";

export const AddSubscriptionInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdSchema,
  alias: z.string().min(1),
  discordUserId: DiscordAccountIdSchema.optional(),
  creatorDiscordId: DiscordAccountIdSchema,
});
export type AddSubscriptionInput = z.infer<typeof AddSubscriptionInputSchema>;

export const RemoveSubscriptionInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  alias: z.string().min(1),
  actorDiscordId: DiscordAccountIdSchema,
});
export type RemoveSubscriptionInput = z.infer<
  typeof RemoveSubscriptionInputSchema
>;

export const MoveSubscriptionInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  alias: z.string().min(1),
  fromChannelId: DiscordChannelIdSchema,
  toChannelId: DiscordChannelIdSchema,
  actorDiscordId: DiscordAccountIdSchema,
});
export type MoveSubscriptionInput = z.infer<typeof MoveSubscriptionInputSchema>;

export const AddSubscriptionChannelInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  alias: z.string().min(1),
  channelId: DiscordChannelIdSchema,
  actorDiscordId: DiscordAccountIdSchema,
});
export type AddSubscriptionChannelInput = z.infer<
  typeof AddSubscriptionChannelInputSchema
>;

export const ListSubscriptionsInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.number().int().min(1).optional(),
});
export type ListSubscriptionsInput = z.infer<
  typeof ListSubscriptionsInputSchema
>;

export type LimitWarning =
  | { kind: "subscription-limit-near"; remaining: number; max: number }
  | { kind: "account-limit-near"; remaining: number; max: number };

export type AddSubscriptionResult =
  | {
      kind: "created";
      subscription: { id: number };
      account: { id: number; puuid: string; region: string; alias: string };
      player: {
        id: number;
        alias: string;
        accounts: { alias: string; region: string }[];
      };
      isAddingToExistingPlayer: boolean;
      isFirstSubscription: boolean;
      warnings: LimitWarning[];
    }
  | {
      kind: "account-already-subscribed";
      existingPlayerAlias: string;
      channelIds: string[];
    }
  | {
      kind: "subscription-already-exists";
      playerAlias: string;
      addedToExistingPlayer: boolean;
      accounts: { alias: string; region: string }[];
    }
  | { kind: "subscription-limit-reached"; current: number; max: number }
  | { kind: "account-limit-reached"; current: number; max: number }
  | { kind: "riot-id-not-found"; message: string }
  | { kind: "internal-error"; message: string };

export type RemoveSubscriptionResult =
  | {
      kind: "removed";
      remainingChannelIds: string[];
      accountsKept: { alias: string; region: string }[];
    }
  | {
      kind: "not-subscribed-in-channel";
      otherChannelIds: string[];
    }
  | { kind: "player-not-found" }
  | { kind: "internal-error"; message: string };

export type MoveSubscriptionResult =
  | { kind: "moved" }
  | { kind: "player-not-found" }
  | { kind: "not-subscribed-in-from-channel" }
  | { kind: "already-subscribed-in-to-channel" }
  | { kind: "same-channel" }
  | { kind: "internal-error"; message: string };

export type AddSubscriptionChannelResult =
  | { kind: "added"; allChannelIds: string[] }
  | { kind: "player-not-found" }
  | { kind: "already-subscribed"; channelId: string }
  | { kind: "internal-error"; message: string };

export type SubscriptionListItem = {
  subscriptionId: number;
  channelId: string;
  player: {
    id: number;
    alias: string;
    discordId: string | null;
    discordUser: ResolvedDiscordUser | null;
    accounts: {
      id: number;
      alias: string;
      region: string;
      puuid: string;
      riotGameName: string | null;
      riotTagLine: string | null;
    }[];
  };
  creatorDiscordId: string;
  creatorDiscordUser: ResolvedDiscordUser | null;
  createdTime: Date;
};
