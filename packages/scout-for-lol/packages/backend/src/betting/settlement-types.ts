/**
 * One bet as the settlement pass sees it.
 *
 * The ledger writer consumes this shape and `settle.ts` calls the ledger, so
 * the contract lives apart from both.
 */

export type SettlementBet = {
  betId: number;
  bucksAccountId: number;
  discordId: string;
  isHouse: boolean;
  predictedTeamId: number;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
  grossPayout: number;
  houseCut: number;
  payout: number;
  winnings: number;
  won: boolean;
  refunded: boolean;
  subjectPuuid: string;
};
