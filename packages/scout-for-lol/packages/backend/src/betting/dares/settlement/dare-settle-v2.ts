import {
  DareStoredPlanV2Schema,
  type DareContractV2,
  type RawMatch,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { pendingDareV2CalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import type { DareTimelineEvidenceV2 } from "#src/betting/dares/evaluation/dare-evaluator-v2.ts";
import { dareEvaluatorImplementationV2 } from "#src/betting/dares/evaluation/dare-evaluator-registry-v2.ts";
import type { DareMatchEvidenceV2 } from "#src/betting/dares/evaluation/dare-evidence-v2.ts";
import { collectDareV2Batch } from "#src/betting/dares/settlement/dare-settle-batch-v2.ts";
import {
  dareV2EvidenceCreateData,
  dareV2EvidencePlanVersion,
  storedDareV2Evidence,
} from "#src/betting/dares/settlement/dare-settle-evidence-v2.ts";
import {
  DareV2PartialSettlementError,
  type DareV2SettlementSummary,
} from "#src/betting/dares/settlement/dare-settle-types-v2.ts";
import { settleDareV2OrVoidOnStorageOverflow } from "#src/betting/dares/settlement/dare-settle-overflow-v2.ts";
import { resolveFinalDareV2 } from "#src/betting/dares/settlement/dare-resolution-v2.ts";
import {
  captureDareSqlV3ForMatch,
  settleDareSqlV3AtDeadline,
} from "#src/betting/dares/settlement/dare-settle-v3.ts";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/betting/dares/evaluation/dare-match-eligibility.ts";
import { reportDareV2BatchFailure } from "#src/betting/dares/settlement/dare-settle-report-v2.ts";
import {
  darePlanNeedsTimeline,
  loadDareTimelineEvidenceV2,
} from "#src/betting/dares/presentation/dare-timeline-evidence-v2.ts";
import {
  dareV2ScoutQlPlanHash,
  parseRelationalDareContract,
  readableRelationalDareContract,
  type RelationalDareContract,
} from "#src/betting/dares/dare-v2-common.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dares/settlement/dare-void-v2.ts";
import { enqueueMaterialDareProgressNotification } from "#src/betting/dares/presentation/notify/dare-notification-production.ts";
import { announceOrWithholdDare } from "#src/betting/dares/settlement/dare-announcement.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
type ActiveDareV2Row = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;
async function captureOneDareV2(
  tx: Db,
  input: {
    dare: ActiveDareV2Row;
    contract: DareContractV2;
    matchEvidence: DareMatchEvidenceV2;
    now: Date;
    notify: DareNotificationDisposition;
  },
): Promise<DareV2SettlementSummary | undefined> {
  const claim = await tx.bucksDareV2.updateMany({
    where: { id: input.dare.id, dareState: "active" },
    data: {
      updatedAt: input.now,
      ...pendingDareV2CalloutRefresh(),
    },
  });
  if (claim.count !== 1) return undefined;
  const captured = await tx.bucksDareV2Evidence.createMany({
    data: [
      dareV2EvidenceCreateData(
        input.dare.id,
        input.matchEvidence,
        dareV2EvidencePlanVersion(input.contract),
      ),
    ],
    skipDuplicates: true,
  });
  if (captured.count !== 1) return undefined;
  const rows = await tx.bucksDareV2Evidence.findMany({
    where: { dareId: input.dare.id },
    orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
  });
  const evidence = rows.map((row) => storedDareV2Evidence(row));
  const evaluator = dareEvaluatorImplementationV2(
    input.contract.evaluatorVersion,
  );
  const finality = evaluator.analyzeFinality({
    plan: input.contract.compiledPlan,
    evidence,
    deadlineReached: false,
  });
  const proof =
    finality.final && finality.value !== null
      ? evaluator.buildProof({
          plan: input.contract.compiledPlan,
          evidence,
          value: finality.value,
          settledAt: input.now.toISOString(),
          compilerVersion: input.contract.compilerVersion,
          evaluatorVersion: input.contract.evaluatorVersion,
          scoutQlPlanHash: dareV2ScoutQlPlanHash(input.contract),
        })
      : null;
  const resolution = finality.final
    ? await resolveFinalDareV2(tx, {
        dare: input.dare,
        contract: input.contract,
        matchId: input.matchEvidence.matchId,
        finality,
        proof,
        now: input.now,
        notify: input.notify,
      })
    : "captured";
  if (resolution === "captured") {
    // A capture is not final, but it still SAYS something: progress toward a
    // Dare, and a callout this capture just marked for refresh. A match owed
    // no public delivery owes neither.
    await announceOrWithholdDare(
      tx,
      { dareId: input.dare.id, notify: input.notify },
      async () => {
        await enqueueMaterialDareProgressNotification(tx, {
          dareId: input.dare.id,
          contract: input.contract,
          evidence,
          matchId: input.matchEvidence.matchId,
          finality,
          now: input.now,
        });
      },
    );
  }
  return {
    contractVersion: 2,
    dareId: input.dare.id,
    serverId: input.dare.serverId,
    channelId: input.dare.channelId,
    matchId: input.matchEvidence.matchId,
    resolution,
    value: finality.value,
    finality,
    proof,
  };
}

async function inspectStoredContract(
  row: ActiveDareV2Row,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<
  | { kind: "valid"; contract: RelationalDareContract }
  | { kind: "invalid"; summary: DareV2SettlementSummary | null }
> {
  const contract = readableRelationalDareContract(row.contractJson);
  if (contract !== null) return { kind: "valid", contract };
  const voided = await voidDareV2WithFullRefund(
    row,
    "invalid_contract",
    prismaClient,
    { now },
  );
  return {
    kind: "invalid",
    summary: voided
      ? {
          contractVersion: 2,
          dareId: row.id,
          serverId: row.serverId,
          channelId: row.channelId,
          resolution: "voided",
          value: null,
          finality: { value: null, final: true, reason: "contract_error" },
          proof: null,
        }
      : null,
  };
}

export async function settleDaresV2ForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  options: {
    now?: Date | undefined;
    timeline?: DareTimelineEvidenceV2 | undefined;
    /** See `SettlementAnnouncementSink.mayEnqueueDareNotification`. */
    notify?: DareNotificationDisposition | undefined;
  } = {},
): Promise<DareV2SettlementSummary[]> {
  const now = options.now ?? new Date();
  const notify = options.notify ?? "enqueue";
  const context = relationalDareMatchContext(matchData);
  if (context === null) return [];
  const rows = await prismaClient.bucksDareV2.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: context.gameStartAt },
      deadlineAt: { gte: context.gameEndAt },
    },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const summaries: DareV2SettlementSummary[] = [];
  const contracts: {
    row: ActiveDareV2Row;
    contract: RelationalDareContract;
  }[] = [];
  const inspected = await collectDareV2Batch(
    rows,
    async (row) => ({
      row,
      outcome: await inspectStoredContract(row, prismaClient, now),
    }),
    (row, error) => {
      reportDareV2BatchFailure(
        "inspect",
        row,
        matchData.metadata.matchId,
        error,
      );
    },
  );
  for (const result of inspected.values) {
    if (result.outcome.kind === "valid") {
      contracts.push({ row: result.row, contract: result.outcome.contract });
    } else if (result.outcome.summary !== null) {
      summaries.push(result.outcome.summary);
    }
  }
  const relevant = contracts.filter(({ contract }) =>
    matchTouchesRelationalDare(matchData, contract),
  );
  if (relevant.length === 0) {
    if (inspected.firstFailure !== null) {
      throw new DareV2PartialSettlementError(
        summaries,
        inspected.firstFailure.error,
      );
    }
    return summaries;
  }
  const needsTimeline = relevant.some(
    ({ contract }) =>
      contract.version === 2 && darePlanNeedsTimeline(contract.compiledPlan),
  );
  let timeline: DareTimelineEvidenceV2;
  try {
    timeline =
      options.timeline ??
      (needsTimeline
        ? await loadDareTimelineEvidenceV2(matchData.metadata.matchId)
        : { coverage: "missing", events: [], participants: [] });
  } catch (error) {
    throw new DareV2PartialSettlementError(summaries, error);
  }
  const captured = await collectDareV2Batch(
    relevant,
    async ({ row, contract }) => {
      if (contract.version === 3) {
        return await captureDareSqlV3ForMatch({
          dare: row,
          contract,
          matchData,
          prismaClient,
          now,
          notify,
        });
      }
      const plan = DareStoredPlanV2Schema.parse(contract.compiledPlan);
      const evaluator = dareEvaluatorImplementationV2(
        contract.evaluatorVersion,
      );
      const matchEvidence = evaluator.evaluateMatch({
        plan,
        targets: contract.targets,
        matchData,
        queue: context.queue,
        timeline,
      });
      if (!Object.values(matchEvidence.candidateSets).some(Boolean)) return;
      return await settleDareV2OrVoidOnStorageOverflow(
        {
          dare: row,
          prismaClient,
          now,
          matchId: matchData.metadata.matchId,
          notify,
        },
        async () =>
          await prismaClient.$transaction(
            async (tx) =>
              await captureOneDareV2(tx, {
                dare: row,
                contract,
                matchEvidence,
                now,
                notify,
              }),
          ),
      );
    },
    ({ row }, error) => {
      reportDareV2BatchFailure(
        "settle",
        row,
        matchData.metadata.matchId,
        error,
      );
    },
  );
  for (const summary of captured.values) {
    if (summary !== undefined) summaries.push(summary);
  }
  const firstFailure = inspected.firstFailure ?? captured.firstFailure;
  if (firstFailure !== null) {
    throw new DareV2PartialSettlementError(summaries, firstFailure.error);
  }
  return summaries;
}

export async function settleActiveDareV2AtBound(
  dare: ActiveDareV2Row,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareV2SettlementSummary | undefined> {
  if (dare.contractJson === null) {
    throw new Error(`Active Dare v2 ${dare.id.toString()} has no contract.`);
  }
  const contract = parseRelationalDareContract(dare.contractJson);
  if (contract.version === 3) {
    return await settleDareV2OrVoidOnStorageOverflow(
      // A deadline bound delivers no match, so nothing here is owed silence.
      { dare, prismaClient, now, notify: "enqueue" },
      async () =>
        await settleDareSqlV3AtDeadline(dare, contract, prismaClient, now),
    );
  }
  const evaluator = dareEvaluatorImplementationV2(contract.evaluatorVersion);
  return await settleDareV2OrVoidOnStorageOverflow(
    { dare, prismaClient, now, notify: "enqueue" },
    async () =>
      await prismaClient.$transaction(async (tx) => {
        const claim = await tx.bucksDareV2.updateMany({
          where: { id: dare.id, dareState: "active" },
          data: { updatedAt: now, ...pendingDareV2CalloutRefresh() },
        });
        if (claim.count !== 1) return;
        const rows = await tx.bucksDareV2Evidence.findMany({
          where: { dareId: dare.id },
          orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
        });
        const evidence = rows.map((row) => storedDareV2Evidence(row));
        const finality = evaluator.analyzeFinality({
          plan: contract.compiledPlan,
          evidence,
          deadlineReached: true,
        });
        const proof =
          finality.value === null
            ? null
            : evaluator.buildProof({
                plan: contract.compiledPlan,
                evidence,
                value: finality.value,
                settledAt: now.toISOString(),
                compilerVersion: contract.compilerVersion,
                evaluatorVersion: contract.evaluatorVersion,
                scoutQlPlanHash: dareV2ScoutQlPlanHash(contract),
              });
        const resolution = await resolveFinalDareV2(tx, {
          dare,
          contract,
          finality,
          proof,
          now,
          // No match is being delivered here, so nothing is owed silence.
          notify: "enqueue",
        });
        return {
          contractVersion: 2,
          dareId: dare.id,
          serverId: dare.serverId,
          channelId: dare.channelId,
          resolution,
          value: finality.value,
          finality,
          proof,
        };
      }),
  );
}
