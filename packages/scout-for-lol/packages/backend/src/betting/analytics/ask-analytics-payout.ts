import type { BucksAskBetOutcome } from "#src/betting/analytics/ask-analytics-schema.ts";

export function netBbForOutcome(
  outcome: BucksAskBetOutcome,
  grossPayout: number | null,
  stake: number,
): number | null {
  switch (outcome) {
    case "pending":
      if (grossPayout !== null) {
        throw new Error(
          "A pending Bryan Bucks position cannot have a gross payout",
        );
      }
      return null;
    case "won":
    case "lost":
      if (grossPayout === null) {
        throw new Error(
          "A resolved Bryan Bucks position must have a gross payout",
        );
      }
      return grossPayout - stake;
    case "refunded":
      if (grossPayout !== stake) {
        throw new Error(
          "A refunded Bryan Bucks position must return its stake",
        );
      }
      return 0;
  }
}

type OutcomeGrossPayoutInput = {
  outcome: BucksAskBetOutcome;
  storedGrossPayout: number | null;
  payout: number | null;
  stake: number;
  payoutCredits: readonly number[];
};

function pendingOutcomeGrossPayout(input: OutcomeGrossPayoutInput): null {
  if (input.payoutCredits.length > 0) {
    throw new Error("A pending Bryan Bucks outcome position has a payout");
  }
  if (input.payout !== null || input.storedGrossPayout !== null) {
    throw new Error("A pending Bryan Bucks outcome position has a payout");
  }
  return null;
}

function wonOutcomeGrossPayout(input: OutcomeGrossPayoutInput): number {
  const ledgerGrossPayout = input.payoutCredits.reduce(
    (sum, credit) => sum + credit,
    0,
  );
  const grossPayout = input.storedGrossPayout ?? ledgerGrossPayout;
  if (input.payoutCredits.length === 0 || input.payout === null) {
    throw new Error(
      "A won Bryan Bucks outcome position must have valid gross payout credits",
    );
  }
  if (ledgerGrossPayout !== grossPayout || grossPayout < input.payout) {
    throw new Error(
      "A won Bryan Bucks outcome position must have valid gross payout credits",
    );
  }
  return grossPayout;
}

function lostOutcomeGrossPayout(input: OutcomeGrossPayoutInput): 0 {
  if (input.payoutCredits.length > 0 || input.payout !== 0) {
    throw new Error("A lost Bryan Bucks outcome position must pay zero");
  }
  if (input.storedGrossPayout !== null && input.storedGrossPayout !== 0) {
    throw new Error("A lost Bryan Bucks outcome position must pay zero");
  }
  return 0;
}

function refundedOutcomeGrossPayout(input: OutcomeGrossPayoutInput): number {
  if (input.payoutCredits.length > 0 || input.payout !== input.stake) {
    throw new Error(
      "A refunded Bryan Bucks outcome position must return its stake without a payout credit",
    );
  }
  if (
    input.storedGrossPayout !== null &&
    input.storedGrossPayout !== input.stake
  ) {
    throw new Error(
      "A refunded Bryan Bucks outcome position must return its stake without a payout credit",
    );
  }
  return input.stake;
}

export function outcomeGrossPayout(
  input: OutcomeGrossPayoutInput,
): number | null {
  switch (input.outcome) {
    case "pending":
      return pendingOutcomeGrossPayout(input);
    case "won":
      return wonOutcomeGrossPayout(input);
    case "lost":
      return lostOutcomeGrossPayout(input);
    case "refunded":
      return refundedOutcomeGrossPayout(input);
  }
}

export function parlayGrossPayout(
  outcome: BucksAskBetOutcome,
  payout: number | null,
  stake: number,
  quotedGrossPayout: number,
): number | null {
  switch (outcome) {
    case "pending":
      if (payout !== null) {
        throw new Error("A pending Bryan Bucks parlay position has a payout");
      }
      return null;
    case "won":
      if (payout !== quotedGrossPayout) {
        throw new Error(
          "A won Bryan Bucks parlay position must pay its stored quote",
        );
      }
      return quotedGrossPayout;
    case "lost":
      if (payout !== 0) {
        throw new Error("A lost Bryan Bucks parlay position must pay zero");
      }
      return 0;
    case "refunded":
      if (payout !== stake) {
        throw new Error(
          "A refunded Bryan Bucks parlay position must return its stake",
        );
      }
      return stake;
  }
}
