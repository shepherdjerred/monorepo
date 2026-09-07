import type {
  BucksAmount,
  BucksStake,
  DiscordAccountId,
  LeaguePuuid,
} from "@scout-for-lol/data";

/**
 * One bet as the settlement pass sees it.
 *
 * The ledger writer consumes this shape and `settle.ts` calls the ledger, so
 * the contract lives apart from both. Money fields carry the Bucks brands:
 * settlement constructs them from parsed storage reads and checked
 * arithmetic, so consumers downstream never re-launder plain numbers.
 */

export type SettlementBet = {
  betId: number;
  bucksAccountId: number;
  discordId: DiscordAccountId;
  isHouse: boolean;
  predictedTeamId: number;
  submittedStake: BucksStake;
  matchedStake: BucksAmount;
  unmatchedStake: BucksAmount;
  grossPayout: BucksAmount;
  houseCut: BucksAmount;
  payout: BucksAmount;
  winnings: BucksAmount;
  won: boolean;
  refunded: boolean;
  subjectPuuid: LeaguePuuid;
};
