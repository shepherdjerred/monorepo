import type { RiotTeamId } from "@scout-for-lol/data";

/**
 * The shape of a pool the sweep has closed.
 *
 * Consumed by the sweep's observability helper, which the sweep imports back.
 */

export type ClosedPosition = {
  betId: number;
  discordId: string;
  teamId: RiotTeamId;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
};

export type ClosedPool = {
  matchId: string;
  serverId: string;
  messageRefs: { channelId: string; messageId: string }[];
  humanMatchedPerSide: number;
  houseFill: number;
  totalMatchedPerSide: number;
  positions: ClosedPosition[];
};
