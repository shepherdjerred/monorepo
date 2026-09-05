import {
  BucksMatchingSummarySchema,
  type BucksMatchingSummary,
} from "@scout-for-lol/data";
import { HOUSE_MATCH_LIMIT } from "#src/betting/constants.ts";
import { settlementHouseCut } from "#src/betting/house-cut.ts";
import {
  auditFinding,
  type BucksAuditSink,
} from "#src/betting/settlement/reconcile-shared.ts";
import type { Db } from "#src/database/index.ts";

async function loadMatchedPools(prismaClient: Db, afterPoolId: number) {
  const pools = await prismaClient.bucksMatchPool.findMany({
    where: { id: { gt: afterPoolId }, matchedAt: { not: null } },
    orderBy: { id: "asc" },
    // A pool's matching summary and positions are one conservation unit. Load
    // one such unit at a time so historical pool count cannot grow memory.
    take: 1,
    select: {
      id: true,
      poolState: true,
      winningTeamId: true,
      voidReason: true,
      matchingJson: true,
      bets: {
        select: {
          id: true,
          bucksAccountId: true,
          bucksAccount: { select: { isHouse: true } },
          predictedTeamId: true,
          stake: true,
          betOutcome: true,
          humanMatchedStake: true,
          houseMatchedStake: true,
          matchedStake: true,
          unmatchedStake: true,
          grossPayout: true,
          fee: true,
          payout: true,
        },
      },
    },
  });
  const betIds = pools.flatMap((pool) => pool.bets.map((bet) => bet.id));
  const houseDebits =
    betIds.length === 0
      ? []
      : await prismaClient.bucksLedgerEntry.groupBy({
          by: ["betId", "bucksAccountId"],
          where: { betId: { in: betIds }, kind: "house_match" },
          _sum: { delta: true },
        });
  return pools.map((pool) => ({
    ...pool,
    bets: pool.bets.map((bet) => ({
      ...bet,
      houseDebit: houseDebits
        .filter(
          (entry) =>
            entry.betId === bet.id &&
            entry.bucksAccountId === bet.bucksAccountId,
        )
        .reduce((sum, entry) => sum + (entry._sum.delta ?? 0), 0),
    })),
  }));
}

type MatchedPool = Awaited<ReturnType<typeof loadMatchedPools>>[number];

function parseMatchingSummary(
  raw: string | null,
): BucksMatchingSummary | undefined {
  if (raw === null) {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return;
  }
  const parsed = BucksMatchingSummarySchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

function activeMatchedBets(pool: MatchedPool) {
  return pool.bets.filter((bet) => bet.betOutcome !== "cancelled");
}

function auditSideTotals(
  pool: MatchedPool,
  summary: BucksMatchingSummary,
  findings: BucksAuditSink,
): void {
  const bets = activeMatchedBets(pool);
  for (const teamId of [100, 200] as const) {
    const sideBets = bets.filter((bet) => bet.predictedTeamId === teamId);
    const matched = sideBets.reduce(
      (sum, bet) => sum + (bet.matchedStake ?? 0),
      0,
    );
    const humanMatched = sideBets
      .filter((bet) => !bet.bucksAccount.isHouse)
      .reduce((sum, bet) => sum + (bet.humanMatchedStake ?? 0), 0);
    if (
      matched !== summary.totalMatchedPerSide ||
      humanMatched !== summary.humanMatchedPerSide
    ) {
      findings.push(
        auditFinding(
          "matching_summary",
          `Team ${teamId.toString()} has ${matched.toString()} matched BB and ${humanMatched.toString()} human-matched BB; summary records ${summary.totalMatchedPerSide.toString()} and ${summary.humanMatchedPerSide.toString()}`,
          { poolId: pool.id },
        ),
      );
    }
  }
}

function auditSummaryAllocations(
  pool: MatchedPool,
  summary: BucksMatchingSummary,
  findings: BucksAuditSink,
): void {
  const humanBets = new Map(
    activeMatchedBets(pool)
      .filter((bet) => !bet.bucksAccount.isHouse)
      .map((bet) => [bet.id, bet]),
  );
  const allocationIds = new Set(
    summary.allocations.map((allocation) => allocation.betId),
  );
  if (
    humanBets.size !== summary.allocations.length ||
    allocationIds.size !== summary.allocations.length
  ) {
    findings.push(
      auditFinding(
        "matching_summary",
        "Pool matching summary does not contain exactly one allocation per human offer",
        { poolId: pool.id },
      ),
    );
  }

  for (const allocation of summary.allocations) {
    const bet = humanBets.get(allocation.betId);
    if (
      bet?.bucksAccountId !== allocation.bucksAccountId ||
      bet.predictedTeamId !== allocation.predictedTeamId ||
      bet.stake !== allocation.submittedStake ||
      bet.humanMatchedStake !== allocation.humanMatchedStake ||
      bet.houseMatchedStake !== allocation.houseMatchedStake ||
      bet.matchedStake !== allocation.matchedStake ||
      bet.unmatchedStake !== allocation.unmatchedStake
    ) {
      findings.push(
        auditFinding(
          "matching_summary",
          "Stored bet allocation differs from the pool matching summary",
          { poolId: pool.id, betId: allocation.betId },
        ),
      );
    }
  }

  const allocatedHouseFill = summary.allocations.reduce(
    (sum, allocation) => sum + allocation.houseMatchedStake,
    0,
  );
  if (allocatedHouseFill !== summary.houseFill) {
    findings.push(
      auditFinding(
        "matching_summary",
        "Human allocation records do not add up to the aggregate house fill",
        { poolId: pool.id },
      ),
    );
  }
}

function auditHouseExposure(
  pool: MatchedPool,
  summary: BucksMatchingSummary,
  findings: BucksAuditSink,
): void {
  const houseBets = activeMatchedBets(pool).filter(
    (bet) => bet.bucksAccount.isHouse,
  );
  const houseBet = houseBets.find((bet) => bet.id === summary.houseBetId);
  const houseDebit = houseBet?.houseDebit ?? 0;
  const hasUnexpectedEmptyHouseState =
    summary.houseBetId !== null ||
    summary.houseTeamId !== null ||
    houseBets.length > 0;
  const emptyHouseInvalid =
    summary.houseFill === 0 && hasUnexpectedEmptyHouseState;
  const fundedHouseInvalid =
    summary.houseFill > 0 &&
    (houseBet === undefined ||
      houseBets.length !== 1 ||
      houseBet.predictedTeamId !== summary.houseTeamId ||
      houseBet.stake !== summary.houseFill ||
      houseBet.matchedStake !== summary.houseFill ||
      houseDebit !== -summary.houseFill);
  if (
    emptyHouseInvalid ||
    fundedHouseInvalid ||
    summary.houseFill > HOUSE_MATCH_LIMIT
  ) {
    findings.push(
      auditFinding(
        "house_exposure",
        `House position is invalid or exceeds the ${HOUSE_MATCH_LIMIT.toString()} BB pool cap`,
        {
          poolId: pool.id,
          ...(summary.houseBetId === null ? {} : { betId: summary.houseBetId }),
        },
      ),
    );
  }
}

function auditPoolPayoutConservation(
  pool: MatchedPool,
  summary: BucksMatchingSummary,
  findings: BucksAuditSink,
): void {
  if (pool.poolState !== "settled" && pool.poolState !== "voided") {
    return;
  }
  const bets = activeMatchedBets(pool);
  const incomplete = bets.some(
    (bet) =>
      bet.betOutcome === "pending" ||
      bet.matchedStake === null ||
      bet.grossPayout === null ||
      bet.fee === null ||
      bet.payout === null,
  );
  const matched = bets.reduce((sum, bet) => sum + (bet.matchedStake ?? 0), 0);
  const gross = bets.reduce((sum, bet) => sum + (bet.grossPayout ?? 0), 0);
  const fees = bets.reduce((sum, bet) => sum + (bet.fee ?? 0), 0);
  const net = bets.reduce((sum, bet) => sum + (bet.payout ?? 0), 0);
  const settlementAmountsInvalid = gross !== matched || net + fees !== gross;
  const matchedPoolInvalid = matched !== summary.totalMatchedPerSide * 2;
  if (incomplete || settlementAmountsInvalid || matchedPoolInvalid) {
    findings.push(
      auditFinding(
        "payout_conservation",
        `Pool settlement does not conserve matched stakes: matched ${matched.toString()}, gross ${gross.toString()}, net ${net.toString()}, fees ${fees.toString()}`,
        { poolId: pool.id },
      ),
    );
  }
}

type TerminalExpectation = {
  outcome: "won" | "lost" | "refunded";
  gross: number;
  fee: number;
  payout: number;
};

function expectedTerminalSettlement(
  pool: MatchedPool,
  bet: ReturnType<typeof activeMatchedBets>[number],
): TerminalExpectation | undefined {
  const matchedStake = bet.matchedStake;
  if (matchedStake === null) {
    return;
  }
  const fullyUnmatched = matchedStake === 0;
  const voided = pool.poolState === "voided";
  const won =
    !fullyUnmatched && !voided && bet.predictedTeamId === pool.winningTeamId;
  const gross = fullyUnmatched
    ? 0
    : voided
      ? matchedStake
      : won
        ? matchedStake * 2
        : 0;
  const fee = settlementHouseCut({
    matchedProfit: won ? matchedStake : 0,
    isHouse: bet.bucksAccount.isHouse,
  });
  return {
    outcome: fullyUnmatched || voided ? "refunded" : won ? "won" : "lost",
    gross,
    fee,
    payout: gross - fee,
  };
}

function auditTerminalBetOutcomes(
  pool: MatchedPool,
  findings: BucksAuditSink,
): void {
  if (pool.poolState !== "settled" && pool.poolState !== "voided") {
    return;
  }
  const invalidPoolResult =
    (pool.poolState === "settled" &&
      ((pool.winningTeamId !== 100 && pool.winningTeamId !== 200) ||
        pool.voidReason !== null)) ||
    (pool.poolState === "voided" &&
      (pool.winningTeamId !== null || pool.voidReason === null));
  if (invalidPoolResult) {
    findings.push(
      auditFinding(
        "settlement",
        "Terminal pool has an invalid winning-team or void result",
        { poolId: pool.id },
      ),
    );
    return;
  }

  for (const bet of activeMatchedBets(pool)) {
    const expected = expectedTerminalSettlement(pool, bet);
    if (expected === undefined) {
      continue;
    }
    if (
      bet.betOutcome !== expected.outcome ||
      bet.grossPayout !== expected.gross ||
      bet.fee !== expected.fee ||
      bet.payout !== expected.payout
    ) {
      findings.push(
        auditFinding(
          "settlement",
          `Bet outcome does not match the pool result: expected ${expected.outcome}, gross ${expected.gross.toString()}, fee ${expected.fee.toString()}, payout ${expected.payout.toString()}`,
          { poolId: pool.id, betId: bet.id },
        ),
      );
    }
  }
}

function auditMatchedPool(pool: MatchedPool, findings: BucksAuditSink): void {
  const summary = parseMatchingSummary(pool.matchingJson);
  if (summary === undefined) {
    findings.push(
      auditFinding(
        "matching_summary",
        "Matched pool has no valid versioned matching summary",
        { poolId: pool.id },
      ),
    );
    return;
  }
  auditSideTotals(pool, summary, findings);
  auditSummaryAllocations(pool, summary, findings);
  auditHouseExposure(pool, summary, findings);
  auditPoolPayoutConservation(pool, summary, findings);
  auditTerminalBetOutcomes(pool, findings);
}

export async function auditBucksMatchedPools(
  prismaClient: Db,
  findings: BucksAuditSink,
): Promise<void> {
  let afterPoolId = 0;
  let hasMorePools = true;
  while (hasMorePools) {
    const pools = await loadMatchedPools(prismaClient, afterPoolId);
    const pool = pools[0];
    hasMorePools = pool !== undefined;
    if (pool === undefined) {
      continue;
    }
    auditMatchedPool(pool, findings);
    afterPoolId = pool.id;
  }
}
