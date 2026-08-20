import {
  BucksMatchingSummarySchema,
  type BucksMatchingSummary,
} from "@scout-for-lol/data";
import { HOUSE_MATCH_LIMIT } from "#src/betting/constants.ts";
import {
  auditFinding,
  type BucksAuditFinding,
} from "#src/betting/reconcile-shared.ts";
import type { Db } from "#src/lib/audit/index.ts";

async function loadMatchedPools(prismaClient: Db) {
  return await prismaClient.bucksMatchPool.findMany({
    where: { matchedAt: { not: null } },
    select: {
      id: true,
      poolState: true,
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
          ledgerEntries: {
            select: { bucksAccountId: true, delta: true, kind: true },
          },
        },
      },
    },
  });
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
  findings: BucksAuditFinding[],
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
  findings: BucksAuditFinding[],
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
  findings: BucksAuditFinding[],
): void {
  const houseBets = activeMatchedBets(pool).filter(
    (bet) => bet.bucksAccount.isHouse,
  );
  const houseBet = houseBets.find((bet) => bet.id === summary.houseBetId);
  const houseDebit =
    houseBet?.ledgerEntries
      .filter(
        (entry) =>
          entry.bucksAccountId === houseBet.bucksAccountId &&
          entry.kind === "house_match",
      )
      .reduce((sum, entry) => sum + entry.delta, 0) ?? 0;
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
  findings: BucksAuditFinding[],
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

function auditMatchedPool(
  pool: MatchedPool,
  findings: BucksAuditFinding[],
): void {
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
}

export async function auditBucksMatchedPools(
  prismaClient: Db,
  findings: BucksAuditFinding[],
): Promise<void> {
  const pools = await loadMatchedPools(prismaClient);
  for (const pool of pools) {
    auditMatchedPool(pool, findings);
  }
}
