import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  cancellationHouseCut,
  settlementHouseCut,
} from "#src/betting/house-cut.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import {
  applyBucksDelta,
  lockBucksAccountsForCredit,
} from "#src/betting/ledger.ts";
import type { Db } from "#src/database/index.ts";
import { bettingSettlementConservationFailuresTotal } from "#src/metrics/betting.ts";

/**
 * The money paths every dare resolution shares.
 *
 * All of these run inside the CALLER's transaction, strictly after the
 * caller's guarded first-statement claim on the dare row — that claim is what
 * serializes a resolution against concurrent contributions, accepts, and
 * other resolutions. The contribution rows are the authoritative pot;
 * `BucksDare.potTotal` is a denormalization these helpers assert against and
 * refuse to trust when it drifts.
 */

/** Common frozen facts every dare ledger row carries. */
export type DareLedgerFacts = {
  dareId: number;
  serverId: string;
  potTotal: number;
  targetAliases: readonly string[];
  conditionSummary: string;
  matchId?: string | undefined;
};

export type DareRefundResolution =
  "declined" | "expired" | "unachieved" | "voided";

export type DareContributorRefund = {
  bucksAccountId: number;
  discordId: string;
  /** Gross total this contributor had in the pot. */
  contributed: number;
  /** House cut withheld (zero on the full-refund paths). */
  fee: number;
  /** Net amount credited back. */
  refunded: number;
};

export type DareTargetPayout = {
  bucksAccountId: number;
  discordId: string;
  alias: string;
  /** floor(pot / N) before the house cut. */
  grossShare: number;
  fee: number;
  /** Net amount credited. */
  net: number;
};

function assertDareConservation(condition: boolean, detail: string): void {
  if (condition) return;
  bettingSettlementConservationFailuresTotal.inc({ stage: "dare" });
  throw new Error(detail);
}

/**
 * Debit one contributor and append their contribution row.
 *
 * Runs strictly after the caller's guarded dare-row claim (which is what
 * proves the pot is still open and serializes the append against
 * settlement). `InsufficientBucksError` propagates and rolls the caller's
 * whole transaction back, including the claim's `potTotal` bookkeeping.
 */
export async function stakeDareContributionInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    bucksAccountId: number;
    discordId: DiscordAccountId;
    amount: number;
  },
): Promise<number> {
  const { facts } = input;
  await tx.bucksDareContribution.create({
    data: {
      dareId: facts.dareId,
      bucksAccountId: input.bucksAccountId,
      discordId: input.discordId,
      amount: input.amount,
    },
  });
  return await applyBucksDelta(tx, {
    bucksAccountId: input.bucksAccountId,
    delta: -input.amount,
    kind: "dare_stake",
    context: {
      type: "dare",
      dareId: facts.dareId,
      role: "contributor",
      targetAliases: [...facts.targetAliases],
      conditionSummary: facts.conditionSummary,
      potTotal: facts.potTotal,
      amount: input.amount,
      payoutComponent: "contribution",
    },
  });
}

/**
 * Refund every contributor, optionally minus the cancellation house cut.
 *
 * The unachieved path charges `cancellationHouseCut` per contributor total;
 * declines, accept-window expiries, and voids refund in full (`withCut:
 * false`), the void-refund precedent. Conservation — refunds plus cuts equal
 * the pot equal the stored total — throws rather than warns.
 */
export async function refundDareContributionsInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    resolution: DareRefundResolution;
    withCut: boolean;
    voidReason?: string | undefined;
  },
): Promise<DareContributorRefund[]> {
  const { facts } = input;
  const contributions = await tx.bucksDareContribution.findMany({
    where: { dareId: facts.dareId },
    orderBy: { id: "asc" },
    select: { bucksAccountId: true, discordId: true, amount: true },
  });
  const pot = contributions.reduce((total, row) => total + row.amount, 0);
  assertDareConservation(
    pot === facts.potTotal,
    `Dare ${facts.dareId.toString()} contribution rows sum to ${pot.toString()} but potTotal is ${facts.potTotal.toString()}`,
  );
  if (contributions.length === 0) {
    return [];
  }

  const byAccount = new Map<number, { discordId: string; total: number }>();
  for (const row of contributions) {
    const existing = byAccount.get(row.bucksAccountId);
    if (existing === undefined) {
      byAccount.set(row.bucksAccountId, {
        discordId: row.discordId,
        total: row.amount,
      });
    } else {
      existing.total += row.amount;
    }
  }
  const refunds: DareContributorRefund[] = [...byAccount.entries()].map(
    ([bucksAccountId, entry]) => {
      const fee = input.withCut ? cancellationHouseCut(entry.total) : 0;
      return {
        bucksAccountId,
        discordId: entry.discordId,
        contributed: entry.total,
        fee,
        refunded: entry.total - fee,
      };
    },
  );
  const totalReturned = refunds.reduce(
    (total, refund) => total + refund.refunded + refund.fee,
    0,
  );
  assertDareConservation(
    totalReturned === pot,
    `Dare ${facts.dareId.toString()} refunds do not conserve the pot: returned ${totalReturned.toString()} of ${pot.toString()}`,
  );

  const serverId = DiscordGuildIdSchema.parse(facts.serverId);
  const anyFees = refunds.some((refund) => refund.fee > 0);
  const house = anyFees
    ? await ensureHouseAccountInTransaction(tx, serverId)
    : undefined;
  await lockBucksAccountsForCredit(tx, [
    ...refunds.map((refund) => refund.bucksAccountId),
    ...(house === undefined ? [] : [house.id]),
  ]);

  const contextBase = {
    type: "dare" as const,
    dareId: facts.dareId,
    targetAliases: [...facts.targetAliases],
    conditionSummary: facts.conditionSummary,
    potTotal: facts.potTotal,
    resolution: input.resolution,
    ...(input.voidReason === undefined ? {} : { voidReason: input.voidReason }),
  };
  for (const refund of refunds) {
    if (refund.refunded > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: refund.bucksAccountId,
        delta: refund.refunded,
        kind: "dare_refund",
        matchId: facts.matchId,
        context: {
          ...contextBase,
          role: "contributor",
          amount: refund.contributed,
          payoutComponent: "refund",
        },
      });
    }
    if (house !== undefined && refund.fee > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: refund.fee,
        kind: "dare_fee",
        matchId: facts.matchId,
        context: {
          ...contextBase,
          role: "house",
          amount: refund.contributed,
          payoutComponent: "refund_fee",
        },
      });
    }
  }
  return refunds;
}

/**
 * Split the pot equally among the accepted targets on an achieved dare.
 *
 * Each target's share is `floor(pot / N)`; the winner fee is
 * `settlementHouseCut` on that share, and the indivisible remainder
 * `pot − N·share` goes to the house (stated in `/bb rules`). Targets held no
 * principal, so unlike `creditBet` there is no principal→fee→profit ordering:
 * one net credit per target plus paired house fee rows, with grossShare kept
 * in every context so history never reconstructs the arithmetic.
 */
export async function payDareTargetsInTransaction(
  tx: Db,
  input: {
    facts: DareLedgerFacts;
    targets: readonly {
      id: number;
      discordId: string;
      alias: string;
      bucksAccountId: number;
    }[];
  },
): Promise<{ payouts: DareTargetPayout[]; remainder: number }> {
  const { facts } = input;
  if (input.targets.length === 0) {
    throw new Error(
      `Dare ${facts.dareId.toString()} reached achieved with no accepted targets`,
    );
  }
  const contributed = await tx.bucksDareContribution.aggregate({
    where: { dareId: facts.dareId },
    _sum: { amount: true },
  });
  const pot = contributed._sum.amount ?? 0;
  assertDareConservation(
    pot === facts.potTotal,
    `Dare ${facts.dareId.toString()} contribution rows sum to ${pot.toString()} but potTotal is ${facts.potTotal.toString()}`,
  );

  const targetCount = input.targets.length;
  const share = Math.floor(pot / targetCount);
  const remainder = pot - targetCount * share;
  const payouts: DareTargetPayout[] = input.targets.map((target) => {
    const fee = settlementHouseCut({ matchedProfit: share, isHouse: false });
    return {
      bucksAccountId: target.bucksAccountId,
      discordId: target.discordId,
      alias: target.alias,
      grossShare: share,
      fee,
      net: share - fee,
    };
  });
  const distributed =
    payouts.reduce((total, payout) => total + payout.net + payout.fee, 0) +
    remainder;
  assertDareConservation(
    distributed === pot,
    `Dare ${facts.dareId.toString()} payouts do not conserve the pot: distributed ${distributed.toString()} of ${pot.toString()}`,
  );

  const serverId = DiscordGuildIdSchema.parse(facts.serverId);
  const house = await ensureHouseAccountInTransaction(tx, serverId);
  await lockBucksAccountsForCredit(tx, [
    ...payouts.map((payout) => payout.bucksAccountId),
    house.id,
  ]);

  const contextBase = {
    type: "dare" as const,
    dareId: facts.dareId,
    targetAliases: [...facts.targetAliases],
    conditionSummary: facts.conditionSummary,
    potTotal: facts.potTotal,
    resolution: "achieved" as const,
  };
  for (const [index, payout] of payouts.entries()) {
    const target = input.targets[index];
    if (target === undefined) {
      throw new Error("Dare payout rows fell out of target alignment");
    }
    await tx.bucksDareTarget.update({
      where: { id: target.id },
      data: { payout: payout.net, fee: payout.fee },
    });
    if (payout.net > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: payout.bucksAccountId,
        delta: payout.net,
        kind: "dare_payout",
        matchId: facts.matchId,
        context: {
          ...contextBase,
          role: "target",
          amount: payout.grossShare,
          payoutComponent: "share",
          grossShare: payout.grossShare,
        },
      });
    }
    if (payout.fee > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: payout.fee,
        kind: "dare_fee",
        matchId: facts.matchId,
        context: {
          ...contextBase,
          role: "house",
          amount: payout.grossShare,
          payoutComponent: "fee",
          grossShare: payout.grossShare,
        },
      });
    }
  }
  if (remainder > 0) {
    await applyBucksDelta(tx, {
      bucksAccountId: house.id,
      delta: remainder,
      kind: "dare_fee",
      matchId: facts.matchId,
      context: {
        ...contextBase,
        role: "house",
        amount: remainder,
        payoutComponent: "remainder",
      },
    });
  }
  return { payouts, remainder };
}
