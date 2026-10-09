import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  BucksAmountSchema,
  BucksStakeSchema,
  DarePotTotalSchema,
  DiscordGuildIdSchema,
  ZERO_BUCKS,
  amountToStake,
  creditOf,
  darePayoutOf,
  debitOf,
  subtractAmounts,
  type BucksAmount,
  type DareChallengerStake,
  type DarePayout,
  type DarePileOn,
  type DarePotTotal,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  cancellationHouseCut,
  settlementHouseCut,
} from "#src/betting/eligibility/house-cut.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/eligibility/house.ts";
import {
  applyBucksDelta,
  lockBucksAccountsForCredit,
} from "#src/betting/ledger.ts";
import type { Db } from "#src/database/index.ts";
import { bettingSettlementConservationFailuresTotal } from "#src/metrics/betting/betting.ts";

export type DareContributorRefund = {
  bucksAccountId: number;
  discordId: string;
  /** Gross total this contributor had in the pot. */
  contributed: BucksAmount;
  /** House cut withheld (zero on the full-refund paths). */
  fee: BucksAmount;
  /** Net amount credited back. */
  refunded: BucksAmount;
};

export type DareTargetPayout = {
  bucksAccountId: number;
  discordId: string;
  alias: string;
  /** floor(pot / N) before the house cut. */
  grossShare: BucksAmount;
  fee: BucksAmount;
  /** Net amount credited. */
  net: DarePayout;
};

export type DareLedgerFacts = {
  dareId: number;
  serverId: string;
  potTotal: DarePotTotal;
  targetAliases: readonly string[];
  conditionSummary: string;
  matchId?: RiotMatchId | undefined;
};

type DarePayoutTarget = {
  id: number;
  discordId: string;
  alias: string;
  bucksAccountId: number;
};

/** The ledger facts for a Dare, with its pot read from storage inside the
 * transaction that will move it. */
export async function dareMoneyFactsInTransaction(
  tx: Db,
  facts: Omit<DareLedgerFacts, "potTotal">,
): Promise<DareLedgerFacts> {
  const row = await tx.bucksDare.findUniqueOrThrow({
    where: { id: facts.dareId },
    select: { potTotal: true },
  });
  return { ...facts, potTotal: DarePotTotalSchema.parse(row.potTotal) };
}

function assertConservation(condition: boolean, detail: string): void {
  if (condition) return;
  bettingSettlementConservationFailuresTotal.inc({ stage: "dare" });
  throw new Error(detail);
}

function contextBase(
  facts: DareLedgerFacts,
  resolution?:
    "achieved" | "unachieved" | "declined" | "expired" | "voided" | "cancelled",
) {
  return {
    type: "dare" as const,
    contractVersion: 3 as const,
    dareId: facts.dareId,
    targetAliases: [...facts.targetAliases],
    conditionSummary: facts.conditionSummary,
    potTotal: BucksStakeSchema.parse(facts.potTotal),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export async function stakeDareContributionInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    bucksAccountId: number;
    discordId: DiscordAccountId;
    amount: DareChallengerStake | DarePileOn;
  },
): Promise<number> {
  await tx.bucksDareContribution.create({
    data: {
      dareId: input.facts.dareId,
      bucksAccountId: input.bucksAccountId,
      discordId: input.discordId,
      amount: input.amount,
    },
  });
  return await applyBucksDelta(tx, {
    bucksAccountId: input.bucksAccountId,
    delta: debitOf(input.amount),
    kind: "dare_stake",
    context: {
      ...contextBase(input.facts),
      role: "contributor",
      amount: input.amount,
      payoutComponent: "contribution",
    },
  });
}

async function contributionTotals(
  tx: Db,
  facts: DareLedgerFacts,
): Promise<Map<number, { discordId: string; total: number }>> {
  const rows = await tx.bucksDareContribution.findMany({
    where: { dareId: facts.dareId },
    orderBy: { id: "asc" },
    select: { bucksAccountId: true, discordId: true, amount: true },
  });
  const pot = rows.reduce((total, row) => total + row.amount, 0);
  assertConservation(
    pot === facts.potTotal,
    `Dare ${facts.dareId.toString()} contributions sum to ${pot.toString()} but potTotal is ${facts.potTotal.toString()}.`,
  );
  const totals = new Map<number, { discordId: string; total: number }>();
  for (const row of rows) {
    const current = totals.get(row.bucksAccountId);
    if (current === undefined) {
      totals.set(row.bucksAccountId, {
        discordId: row.discordId,
        total: row.amount,
      });
    } else {
      current.total += row.amount;
    }
  }
  return totals;
}

export async function refundDareContributionsInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    resolution: "unachieved" | "declined" | "expired" | "voided" | "cancelled";
    withCut: boolean;
    voidReason?: string | undefined;
  },
): Promise<DareContributorRefund[]> {
  const totals = await contributionTotals(tx, input.facts);
  const refunds = [...totals.entries()].map(([bucksAccountId, entry]) => {
    const contributed = BucksAmountSchema.parse(entry.total);
    const fee = input.withCut ? cancellationHouseCut(contributed) : ZERO_BUCKS;
    return {
      bucksAccountId,
      discordId: entry.discordId,
      contributed,
      fee,
      refunded: subtractAmounts(contributed, fee),
    };
  });
  const house = refunds.some((refund) => refund.fee > 0)
    ? await ensureHouseAccountInTransaction(
        tx,
        DiscordGuildIdSchema.parse(input.facts.serverId),
      )
    : undefined;
  await lockBucksAccountsForCredit(tx, [
    ...refunds.map((refund) => refund.bucksAccountId),
    ...(house === undefined ? [] : [house.id]),
  ]);
  for (const refund of refunds) {
    if (refund.refunded > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: refund.bucksAccountId,
        delta: creditOf(refund.refunded),
        kind: "dare_refund",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, input.resolution),
          role: "contributor",
          amount: amountToStake(refund.contributed),
          payoutComponent: "refund",
          ...(input.voidReason === undefined
            ? {}
            : { voidReason: input.voidReason }),
        },
      });
    }
    if (house !== undefined && refund.fee > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: creditOf(refund.fee),
        kind: "dare_fee",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, input.resolution),
          role: "house",
          amount: amountToStake(refund.contributed),
          payoutComponent: "refund_fee",
        },
      });
    }
  }
  return refunds;
}

export async function payDareTargetsInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    targets: readonly DarePayoutTarget[];
    remainderTargetId?: number | undefined;
  },
): Promise<DareTargetPayout[]> {
  if (input.targets.length === 0) {
    throw new Error(
      `Achieved Dare ${input.facts.dareId.toString()} has no proof targets.`,
    );
  }
  await contributionTotals(tx, input.facts);
  const { payouts, remainder } = allocateDareTargetPayouts(input);
  const house = await ensureHouseAccountInTransaction(
    tx,
    DiscordGuildIdSchema.parse(input.facts.serverId),
  );
  await lockBucksAccountsForCredit(tx, [
    ...payouts.map((payout) => payout.bucksAccountId),
    house.id,
  ]);
  for (const [index, payout] of payouts.entries()) {
    const target = input.targets[index];
    if (target === undefined) throw new Error("Dare payout alignment failed.");
    await tx.bucksDareTarget.update({
      where: { id: target.id },
      data: { payout: payout.net, fee: payout.fee },
    });
    if (payout.net > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: payout.bucksAccountId,
        delta: creditOf(payout.net),
        kind: "dare_payout",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, "achieved"),
          role: "target",
          amount: amountToStake(payout.grossShare),
          payoutComponent: "share",
          grossShare: payout.grossShare,
        },
      });
    }
    if (payout.fee > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: creditOf(payout.fee),
        kind: "dare_fee",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, "achieved"),
          role: "house",
          amount: amountToStake(payout.grossShare),
          payoutComponent: "fee",
          grossShare: payout.grossShare,
        },
      });
    }
  }
  if (remainder > 0 && input.remainderTargetId === undefined) {
    const indivisible = BucksStakeSchema.parse(remainder);
    await applyBucksDelta(tx, {
      bucksAccountId: house.id,
      delta: creditOf(indivisible),
      kind: "dare_fee",
      matchId: input.facts.matchId,
      context: {
        ...contextBase(input.facts, "achieved"),
        role: "house",
        amount: indivisible,
        payoutComponent: "remainder",
      },
    });
  }
  return payouts;
}

export function allocateDareTargetPayouts(input: {
  facts: DareLedgerFacts;
  targets: readonly DarePayoutTarget[];
  remainderTargetId?: number | undefined;
}): { payouts: DareTargetPayout[]; remainder: number } {
  if (input.targets.length === 0) {
    throw new Error(
      `Achieved Dare ${input.facts.dareId.toString()} has no proof targets.`,
    );
  }
  const share = Math.floor(input.facts.potTotal / input.targets.length);
  const remainder = input.facts.potTotal - share * input.targets.length;
  if (
    input.remainderTargetId !== undefined &&
    !input.targets.some((target) => target.id === input.remainderTargetId)
  ) {
    throw new Error("Dare payout remainder target is not a payee.");
  }
  const payouts = input.targets.map((target) => {
    const grossShare = BucksAmountSchema.parse(
      share + (target.id === input.remainderTargetId ? remainder : 0),
    );
    const fee = settlementHouseCut({
      matchedProfit: grossShare,
      isHouse: false,
    });
    return {
      bucksAccountId: target.bucksAccountId,
      discordId: target.discordId,
      alias: target.alias,
      grossShare,
      fee,
      net: darePayoutOf(grossShare, fee),
    };
  });
  assertConservation(
    payouts.reduce((total, payout) => total + payout.grossShare, 0) +
      (input.remainderTargetId === undefined ? remainder : 0) ===
      input.facts.potTotal,
    `Dare ${input.facts.dareId.toString()} payout shares do not conserve the pot.`,
  );
  return { payouts, remainder };
}
