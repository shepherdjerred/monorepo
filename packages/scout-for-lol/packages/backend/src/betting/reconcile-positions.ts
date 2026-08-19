import type { Db } from "#src/lib/audit/index.ts";
import {
  auditFinding,
  type BucksAuditFinding,
} from "#src/betting/reconcile-shared.ts";

async function loadBets(prismaClient: Db) {
  return await prismaClient.bucksBet.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      poolId: true,
      bucksAccountId: true,
      bucksAccount: { select: { isHouse: true } },
      pool: { select: { poolState: true, matchedAt: true } },
      stake: true,
      betOutcome: true,
      humanMatchedStake: true,
      houseMatchedStake: true,
      matchedStake: true,
      unmatchedStake: true,
      grossPayout: true,
      fee: true,
      payout: true,
      ledgerEntries: {
        select: { bucksAccountId: true, delta: true, kind: true },
      },
    },
  });
}

type ReconciliationBet = Awaited<ReturnType<typeof loadBets>>[number];

type CompleteAllocation = {
  humanMatchedStake: number;
  houseMatchedStake: number;
  matchedStake: number;
  unmatchedStake: number;
};

function ownLedgerSum(bet: ReconciliationBet, kind: string): number {
  return bet.ledgerEntries
    .filter(
      (entry) =>
        entry.bucksAccountId === bet.bucksAccountId && entry.kind === kind,
    )
    .reduce((sum, entry) => sum + entry.delta, 0);
}

function linkedLedgerSum(bet: ReconciliationBet, kind: string): number {
  return bet.ledgerEntries
    .filter((entry) => entry.kind === kind)
    .reduce((sum, entry) => sum + entry.delta, 0);
}

function auditReservedStake(
  bet: ReconciliationBet,
  findings: BucksAuditFinding[],
): void {
  const currentHouseBet =
    bet.bucksAccount.isHouse && bet.pool.matchedAt !== null;
  const kind = currentHouseBet ? "house_match" : "bet_stake";
  if (!currentHouseBet && bet.bucksAccount.isHouse) {
    return;
  }
  const reserved = ownLedgerSum(bet, kind);
  if (reserved !== -bet.stake) {
    findings.push(
      auditFinding(
        "reserved_stake",
        `${kind} reserved ${(-reserved).toString()} BB for a ${bet.stake.toString()} BB submitted position`,
        {
          poolId: bet.poolId,
          betId: bet.id,
          bucksAccountId: bet.bucksAccountId,
        },
      ),
    );
  }
}

function readAllocation(
  bet: ReconciliationBet,
  findings: BucksAuditFinding[],
): CompleteAllocation | undefined {
  if (
    bet.humanMatchedStake === null &&
    bet.houseMatchedStake === null &&
    bet.matchedStake === null &&
    bet.unmatchedStake === null
  ) {
    return;
  }
  if (
    bet.humanMatchedStake === null ||
    bet.houseMatchedStake === null ||
    bet.matchedStake === null ||
    bet.unmatchedStake === null
  ) {
    findings.push(
      auditFinding(
        "allocation",
        "Bet has a partially populated matching allocation",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
    return;
  }
  return {
    humanMatchedStake: bet.humanMatchedStake,
    houseMatchedStake: bet.houseMatchedStake,
    matchedStake: bet.matchedStake,
    unmatchedStake: bet.unmatchedStake,
  };
}

function auditAllocation(
  bet: ReconciliationBet,
  allocation: CompleteAllocation,
  findings: BucksAuditFinding[],
): void {
  const amounts = [
    allocation.humanMatchedStake,
    allocation.houseMatchedStake,
    allocation.matchedStake,
    allocation.unmatchedStake,
  ];
  if (
    amounts.some((value) => value < 0) ||
    allocation.matchedStake !==
      allocation.humanMatchedStake + allocation.houseMatchedStake ||
    bet.stake !== allocation.matchedStake + allocation.unmatchedStake
  ) {
    findings.push(
      auditFinding(
        "allocation",
        "Bet allocation does not conserve its submitted maximum",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }
}

function auditUnmatchedRefund(
  bet: ReconciliationBet,
  allocation: CompleteAllocation,
  findings: BucksAuditFinding[],
): void {
  if (bet.betOutcome === "cancelled") {
    return;
  }
  const refund = ownLedgerSum(bet, "bet_unmatched_refund");
  if (refund !== allocation.unmatchedStake) {
    findings.push(
      auditFinding(
        "refund",
        `Unmatched refund ${refund.toString()} differs from allocation ${allocation.unmatchedStake.toString()}`,
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }
}

function auditCancellation(
  bet: ReconciliationBet,
  allocation: CompleteAllocation,
  findings: BucksAuditFinding[],
): void {
  const refund = ownLedgerSum(bet, "bet_cancel_refund");
  const ownFee = ownLedgerSum(bet, "cancel_fee");
  const pairedFee = linkedLedgerSum(bet, "cancel_fee");
  const fee = bet.fee;
  if (
    fee === null ||
    allocation.matchedStake !== 0 ||
    allocation.unmatchedStake !== bet.stake ||
    refund !== bet.stake ||
    bet.grossPayout !== bet.stake ||
    bet.payout !== bet.stake - fee
  ) {
    findings.push(
      auditFinding(
        "refund",
        "Cancelled bet does not reconcile to its gross refund and fee",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }
  if (fee === null) {
    return;
  }
  if (pairedFee !== 0 || ownFee !== -fee) {
    findings.push(
      auditFinding(
        "fee",
        "Cancellation fee is not a balanced user-to-house ledger transfer",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }
}

function auditTerminalSettlement(
  bet: ReconciliationBet,
  findings: BucksAuditFinding[],
): void {
  if (bet.betOutcome === "pending") {
    return;
  }
  const grossPayout = bet.grossPayout;
  const fee = bet.fee;
  const payout = bet.payout;
  if (grossPayout === null || fee === null || payout === null) {
    findings.push(
      auditFinding(
        "settlement",
        "Resolved bet is missing gross payout, fee, or net payout",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
    return;
  }
  if (payout !== grossPayout - fee) {
    findings.push(
      auditFinding(
        "settlement",
        "Resolved bet's gross payout minus fee does not equal net payout",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }

  const grossKind =
    bet.betOutcome === "refunded" ? "bet_void_refund" : "bet_payout";
  const grossLedger = ownLedgerSum(bet, grossKind);
  if (grossLedger !== grossPayout) {
    findings.push(
      auditFinding(
        "payout_conservation",
        `${grossKind} ledger total ${grossLedger.toString()} differs from gross payout ${grossPayout.toString()}`,
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }

  const ownFee = ownLedgerSum(bet, "winner_fee");
  const pairedFee = linkedLedgerSum(bet, "winner_fee");
  if (pairedFee !== 0 || ownFee !== -fee) {
    findings.push(
      auditFinding(
        "fee",
        "Winner fee is not a balanced user-to-house ledger transfer",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }
}

function auditBet(
  bet: ReconciliationBet,
  activeBetIds: ReadonlySet<number>,
  findings: BucksAuditFinding[],
): void {
  if (
    !activeBetIds.has(bet.id) &&
    bet.pool.poolState === "open" &&
    bet.pool.matchedAt === null &&
    bet.betOutcome === "pending" &&
    !bet.bucksAccount.isHouse
  ) {
    findings.push(
      auditFinding(
        "active_position",
        "Pending offer in an open pool has no active-position slot",
        { poolId: bet.poolId, betId: bet.id },
      ),
    );
  }

  auditReservedStake(bet, findings);
  const allocation = readAllocation(bet, findings);
  if (allocation === undefined) {
    return;
  }
  auditAllocation(bet, allocation, findings);
  auditUnmatchedRefund(bet, allocation, findings);
  if (bet.betOutcome === "cancelled") {
    auditCancellation(bet, allocation, findings);
  } else {
    auditTerminalSettlement(bet, findings);
  }
}

async function auditActiveSlots(
  prismaClient: Db,
  findings: BucksAuditFinding[],
): Promise<ReadonlySet<number>> {
  const positions = await prismaClient.bucksOpenPosition.findMany({
    select: {
      poolId: true,
      bucksAccountId: true,
      betId: true,
      pool: { select: { poolState: true, matchedAt: true } },
      bet: {
        select: { poolId: true, bucksAccountId: true, betOutcome: true },
      },
    },
  });
  for (const slot of positions) {
    if (
      slot.pool.poolState !== "open" ||
      slot.pool.matchedAt !== null ||
      slot.bet.poolId !== slot.poolId ||
      slot.bet.bucksAccountId !== slot.bucksAccountId ||
      slot.bet.betOutcome !== "pending"
    ) {
      findings.push(
        auditFinding(
          "active_position",
          "Active-position slot does not point to one pending offer in an unmatched open pool",
          {
            poolId: slot.poolId,
            betId: slot.betId,
            bucksAccountId: slot.bucksAccountId,
          },
        ),
      );
    }
  }
  return new Set(positions.map((slot) => slot.betId));
}

export async function auditBucksPositions(
  prismaClient: Db,
  findings: BucksAuditFinding[],
): Promise<void> {
  const activeBetIds = await auditActiveSlots(prismaClient, findings);
  const bets = await loadBets(prismaClient);
  for (const bet of bets) {
    auditBet(bet, activeBetIds, findings);
  }
}
