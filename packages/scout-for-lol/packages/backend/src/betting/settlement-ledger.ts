import {
  DiscordGuildIdSchema,
  type BucksLedgerContext,
  type BucksPoolParticipant,
  type BucksVoidReason,
} from "@scout-for-lol/data";
import { HOUSE_CUT_PERCENT } from "#src/betting/house-cut.ts";
import { transferHouseCut } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import type { SettlementBet } from "#src/betting/settlement-types.ts";
import type { Db } from "#src/lib/audit/index.ts";

type CreditBetInput = {
  bet: SettlementBet;
  matchId: string;
  serverId: string;
  roster: readonly BucksPoolParticipant[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
  winnersPool: number;
  losersPool: number;
};

type PayoutComponent = "gross" | "principal" | "profit" | "refund";

function aliasesForTeam(
  roster: readonly BucksPoolParticipant[],
  teamId: number,
): string[] {
  return roster
    .filter((participant) => participant.teamId === teamId)
    .map((participant) => participant.trackedAlias)
    .filter((alias) => alias !== undefined);
}

function subjectAlias(
  roster: readonly BucksPoolParticipant[],
  puuid: string,
): string {
  const found = roster.find((participant) => participant.puuid === puuid);
  return found?.trackedAlias ?? "a tracked player";
}

function settlementLedgerContext(
  input: CreditBetInput,
  payoutComponent: PayoutComponent,
): BucksLedgerContext {
  const { bet } = input;
  return {
    type: "settlement",
    subjectAlias: subjectAlias(input.roster, bet.subjectPuuid),
    backedAliases: aliasesForTeam(input.roster, bet.predictedTeamId),
    opposingAliases: aliasesForTeam(
      input.roster,
      bet.predictedTeamId === 100 ? 200 : 100,
    ),
    winnersPool: input.winnersPool,
    losersPool: input.losersPool,
    stakeReturned: bet.matchedStake,
    winnings: bet.winnings,
    grossPayout: bet.grossPayout,
    houseCut: bet.houseCut,
    netPayout: bet.payout,
    submittedStake: bet.submittedStake,
    matchedStake: bet.matchedStake,
    unmatchedStake: bet.unmatchedStake,
    payoutComponent,
    voidReason: input.voidReason,
  };
}

async function creditSettlementPayout(
  tx: Db,
  input: CreditBetInput,
  delta: number,
  payoutComponent: PayoutComponent,
): Promise<void> {
  await applyBucksDelta(tx, {
    bucksAccountId: input.bet.bucksAccountId,
    delta,
    kind: input.bet.refunded ? "bet_void_refund" : "bet_payout",
    matchId: input.matchId,
    betId: input.bet.betId,
    predictedTeamId: input.bet.predictedTeamId,
    actualWinningTeamId: input.winningTeamId,
    context: settlementLedgerContext(input, payoutComponent),
  });
}

async function transferWinnerFee(tx: Db, input: CreditBetInput): Promise<void> {
  const { bet } = input;
  await transferHouseCut(tx, {
    serverId: DiscordGuildIdSchema.parse(input.serverId),
    bucksAccountId: bet.bucksAccountId,
    amount: bet.houseCut,
    kind: "winner_fee",
    matchId: input.matchId,
    betId: bet.betId,
    context: {
      type: "house_fee",
      source: "settlement",
      ratePercent: HOUSE_CUT_PERCENT,
      grossAmount: bet.matchedStake,
      fee: bet.houseCut,
      basis: "matched_profit",
    },
  });
}

export async function creditBet(tx: Db, input: CreditBetInput): Promise<void> {
  const { bet } = input;
  if (bet.grossPayout === 0) {
    if (bet.houseCut !== 0) {
      throw new Error("A zero-payout Bryan Bucks position cannot have a fee");
    }
    return;
  }

  if (bet.refunded || bet.houseCut === 0) {
    await creditSettlementPayout(
      tx,
      input,
      bet.grossPayout,
      bet.refunded ? "refund" : "gross",
    );
    return;
  }

  // A fee-paying winner can have a representable final balance even when a
  // gross credit would overflow temporarily. Principal funds the fee, then
  // profit lands after that debit. The two payout rows still sum to the stored
  // gross payout and make the ordering explicit in the ledger context.
  const grossProfit = bet.grossPayout - bet.matchedStake;
  if (grossProfit <= 0) {
    throw new Error("A Bryan Bucks winner fee requires positive gross profit");
  }
  await creditSettlementPayout(tx, input, bet.matchedStake, "principal");
  await transferWinnerFee(tx, input);
  await creditSettlementPayout(tx, input, grossProfit, "profit");
}
