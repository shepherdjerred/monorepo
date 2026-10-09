import type {
  DiscordGuildId,
  DiscordChannelId,
  DiscordAccountId,
} from "@scout-for-lol/domain/identity/discord.ts";
import type {
  RiotMatchId,
  DiscordMessageId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { RiotTeamId } from "@scout-for-lol/data";

/**
 * The shape of a pool the sweep has closed.
 *
 * Consumed by the sweep's observability helper, which the sweep imports back.
 */

export type ClosedPosition = {
  betId: number;
  discordId: DiscordAccountId;
  teamId: RiotTeamId;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
};

export type ClosedPool = {
  matchId: RiotMatchId;
  serverId: DiscordGuildId;
  messageRefs: { channelId: DiscordChannelId; messageId: DiscordMessageId }[];
  humanMatchedPerSide: number;
  houseFill: number;
  totalMatchedPerSide: number;
  positions: ClosedPosition[];
};
