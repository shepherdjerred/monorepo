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
import type {
  DareContributorRefund,
  DareTargetPayout,
} from "#src/betting/dare-ledger.ts";
import type { Db } from "#src/database/index.ts";
import { bettingSettlementConservationFailuresTotal } from "#src/metrics/betting.ts";

export type DareV2LedgerFacts = {
  dareId: number;
  serverId: string;
  potTotal: number;
  targetAliases: readonly string[];
  conditionSummary: string;
  matchId?: string | undefined;
};

type DareV2PayoutTarget = {
  id: number;
  discordId: string;
  alias: string;
  bucksAccountId: number;
};

export async function dareV2MoneyFactsInTransaction(
  tx: Db,
  facts: DareV2LedgerFacts,
): Promise<DareV2LedgerFacts> {
  const row = await tx.bucksDareV2.findUniqueOrThrow({
    where: { id: facts.dareId },
    select: { potTotal: true },
  });
  return { ...facts, potTotal: row.potTotal };
}

function assertConservation(condition: boolean, detail: string): void {
  if (condition) return;
  bettingSettlementConservationFailuresTotal.inc({ stage: "dare" });
  throw new Error(detail);
}

function contextBase(
  facts: DareV2LedgerFacts,
  resolution?:
    "achieved" | "unachieved" | "declined" | "expired" | "voided" | "cancelled",
) {
  return {
    type: "dare" as const,
    contractVersion: 2 as const,
    dareId: facts.dareId,
    targetAliases: [...facts.targetAliases],
    conditionSummary: facts.conditionSummary,
    potTotal: facts.potTotal,
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export async function stakeDareV2ContributionInTransaction(
  tx: Db,
  input: {
    facts: DareV2LedgerFacts;
    bucksAccountId: number;
    discordId: DiscordAccountId;
    amount: number;
  },
): Promise<number> {
  await tx.bucksDareV2Contribution.create({
    data: {
      dareId: input.facts.dareId,
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
      ...contextBase(input.facts),
      role: "contributor",
      amount: input.amount,
      payoutComponent: "contribution",
    },
  });
}

async function contributionTotals(
  tx: Db,
  facts: DareV2LedgerFacts,
): Promise<Map<number, { discordId: string; total: number }>> {
  const rows = await tx.bucksDareV2Contribution.findMany({
    where: { dareId: facts.dareId },
    orderBy: { id: "asc" },
    select: { bucksAccountId: true, discordId: true, amount: true },
  });
  const pot = rows.reduce((total, row) => total + row.amount, 0);
  assertConservation(
    pot === facts.potTotal,
    `Dare v2 ${facts.dareId.toString()} contributions sum to ${pot.toString()} but potTotal is ${facts.potTotal.toString()}.`,
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

export async function refundDareV2ContributionsInTransaction(
  tx: Db,
  input: {
    facts: DareV2LedgerFacts;
    resolution: "unachieved" | "declined" | "expired" | "voided" | "cancelled";
    withCut: boolean;
    voidReason?: string | undefined;
  },
): Promise<DareContributorRefund[]> {
  const totals = await contributionTotals(tx, input.facts);
  const refunds = [...totals.entries()].map(([bucksAccountId, entry]) => {
    const fee = input.withCut ? cancellationHouseCut(entry.total) : 0;
    return {
      bucksAccountId,
      discordId: entry.discordId,
      contributed: entry.total,
      fee,
      refunded: entry.total - fee,
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
        delta: refund.refunded,
        kind: "dare_refund",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, input.resolution),
          role: "contributor",
          amount: refund.contributed,
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
        delta: refund.fee,
        kind: "dare_fee",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, input.resolution),
          role: "house",
          amount: refund.contributed,
          payoutComponent: "refund_fee",
        },
      });
    }
  }
  return refunds;
}

export async function payDareV2TargetsInTransaction(
  tx: Db,
  input: {
    facts: DareV2LedgerFacts;
    targets: readonly DareV2PayoutTarget[];
    remainderTargetId?: number | undefined;
  },
): Promise<DareTargetPayout[]> {
  if (input.targets.length === 0) {
    throw new Error(
      `Achieved Dare v2 ${input.facts.dareId.toString()} has no proof targets.`,
    );
  }
  await contributionTotals(tx, input.facts);
  const { payouts, remainder } = allocateDareV2TargetPayouts(input);
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
    if (target === undefined)
      throw new Error("Dare v2 payout alignment failed.");
    await tx.bucksDareV2Target.update({
      where: { id: target.id },
      data: { payout: payout.net, fee: payout.fee },
    });
    if (payout.net > 0) {
      await applyBucksDelta(tx, {
        bucksAccountId: payout.bucksAccountId,
        delta: payout.net,
        kind: "dare_payout",
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, "achieved"),
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
        matchId: input.facts.matchId,
        context: {
          ...contextBase(input.facts, "achieved"),
          role: "house",
          amount: payout.grossShare,
          payoutComponent: "fee",
          grossShare: payout.grossShare,
        },
      });
    }
  }
  if (remainder > 0 && input.remainderTargetId === undefined) {
    await applyBucksDelta(tx, {
      bucksAccountId: house.id,
      delta: remainder,
      kind: "dare_fee",
      matchId: input.facts.matchId,
      context: {
        ...contextBase(input.facts, "achieved"),
        role: "house",
        amount: remainder,
        payoutComponent: "remainder",
      },
    });
  }
  return payouts;
}

export function allocateDareV2TargetPayouts(input: {
  facts: DareV2LedgerFacts;
  targets: readonly DareV2PayoutTarget[];
  remainderTargetId?: number | undefined;
}): { payouts: DareTargetPayout[]; remainder: number } {
  if (input.targets.length === 0) {
    throw new Error(
      `Achieved Dare v2 ${input.facts.dareId.toString()} has no proof targets.`,
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
    const grossShare =
      share + (target.id === input.remainderTargetId ? remainder : 0);
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
      net: grossShare - fee,
    };
  });
  assertConservation(
    payouts.reduce((total, payout) => total + payout.grossShare, 0) +
      (input.remainderTargetId === undefined ? remainder : 0) ===
      input.facts.potTotal,
    `Dare v2 ${input.facts.dareId.toString()} payout shares do not conserve the pot.`,
  );
  return { payouts, remainder };
}
