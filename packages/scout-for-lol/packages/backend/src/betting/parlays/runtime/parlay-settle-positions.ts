import {
  BucksDeltaSchema,
  BucksParlaySideSchema,
  BucksStakeSchema,
  type BucksParlayVoidReason,
} from "@scout-for-lol/data";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import type { Db } from "#src/database/index.ts";
import type {
  ParlaySettlementBet,
  PlannedPosition,
} from "#src/betting/parlays/runtime/parlay-settlement-types.ts";

/**
 * Paying one settled parlay position.
 *
 * Split from the settling transaction when that file crossed its line cap.
 * Only the payment moved: the planning above it carries a pre-existing
 * complexity suppression keyed to that file's path, and relocating code out
 * from under a suppression would either strand it or require editing the
 * suppression list to keep a move green — neither of which a pure move is
 * allowed to do.
 */

export async function settlePosition(
  tx: Db,
  input: {
    position: PlannedPosition;
    houseId: number;
    houseRefundableHeldAfterSettlement: bigint;
    matchId: string;
    voidReason: BucksParlayVoidReason | undefined;
    yesResult: boolean | undefined;
  },
): Promise<ParlaySettlementBet> {
  const { bet, outcome, payout } = input.position;
  const side = BucksParlaySideSchema.parse(bet.side);
  const contextBase = {
    type: "parlay_settlement" as const,
    side,
    stake: BucksStakeSchema.parse(bet.stake),
    reserve: bet.houseReserve,
    grossPayout: BucksStakeSchema.parse(bet.grossPayout),
  };
  if (outcome === "refunded") {
    await applyBucksDelta(tx, {
      bucksAccountId: bet.bucksAccountId,
      delta: BucksDeltaSchema.parse(bet.stake),
      kind: "parlay_refund",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        ...contextBase,
        credited: bet.stake,
        voidReason: input.voidReason,
      },
      knownRefundableHeld: bet.refundableHeld - BigInt(bet.stake),
    });
    await applyBucksDelta(tx, {
      bucksAccountId: input.houseId,
      delta: BucksDeltaSchema.parse(bet.houseReserve),
      kind: "parlay_release",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        ...contextBase,
        credited: bet.houseReserve,
        voidReason: input.voidReason,
      },
      knownRefundableHeld: input.houseRefundableHeldAfterSettlement,
    });
    return {
      discordId: bet.bucksAccount.discordId,
      side,
      stake: bet.stake,
      grossPayout: bet.grossPayout,
      payout,
      outcome,
    };
  }

  const won = outcome === "won";
  await applyBucksDelta(tx, {
    bucksAccountId: won ? bet.bucksAccountId : input.houseId,
    delta: BucksDeltaSchema.parse(bet.grossPayout),
    kind: won ? "parlay_payout" : "parlay_release",
    matchId: input.matchId,
    parlayBetId: bet.id,
    context: {
      ...contextBase,
      yesResult: input.yesResult,
      credited: bet.grossPayout,
    },
    knownRefundableHeld: won
      ? bet.refundableHeld - BigInt(bet.stake)
      : input.houseRefundableHeldAfterSettlement,
  });
  return {
    discordId: bet.bucksAccount.discordId,
    side,
    stake: bet.stake,
    grossPayout: bet.grossPayout,
    payout,
    outcome,
  };
}
