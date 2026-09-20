import type {
  BucksParlaySide,
  BucksParlayVoidReason,
} from "@scout-for-lol/data";
import type { ParlayLegResult } from "#src/betting/parlays/parlay-evaluator.ts";

/**
 * What one parlay settlement produced, and who it moved money for.
 *
 * Here rather than beside the settling code because that is what the
 * dependency graph says: ten modules import these two types and one imports
 * the settler. Announcements, direct messages, the notification codecs and
 * the V2 intent minter all describe a settled parlay without performing one,
 * and a type they all need should not oblige them to reach into the module
 * that does the work — which is also how the straight-pool settlement grew
 * an import cycle when its own summary type stayed behind.
 */
export type ParlaySettlementBet = {
  discordId: string;
  side: BucksParlaySide;
  stake: number;
  grossPayout: number;
  payout: number;
  outcome: "won" | "lost" | "refunded";
};

export type ParlaySettlementSummary = {
  matchId: string;
  serverId: string;
  yesResult: boolean | undefined;
  voidReason: BucksParlayVoidReason | undefined;
  legs: ParlayLegResult[];
  messageRefs: { channelId: string; messageId: string }[];
  bets: ParlaySettlementBet[];
};

export type PendingParlayBet = {
  id: number;
  bucksAccountId: number;
  side: string;
  stake: number;
  houseReserve: number;
  grossPayout: number;
  bucksAccount: {
    discordId: string;
    serverId: string;
    isHouse: boolean;
    balance: number;
  };
  refundableHeld: bigint;
};

/**
 * One parlay position, planned but not yet paid.
 *
 * Here with the other settlement descriptions rather than beside the settler,
 * for the reason the two summary types are: the payment half needs to
 * DESCRIBE a position without performing one, and a type that stayed with
 * the machinery made the two runtime halves point back at each other.
 */
export type PlannedPosition = {
  bet: PendingParlayBet;
  outcome: "won" | "lost" | "refunded";
  payout: number;
};
