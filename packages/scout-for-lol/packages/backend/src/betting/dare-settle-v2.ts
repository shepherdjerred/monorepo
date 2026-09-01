import * as Sentry from "@sentry/bun";
import {
  DareCompiledPlanV2Schema,
  resolveQueueTypeFromGame,
  type DareContractV2,
  type RawMatch,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import type { DareTimelineEvidenceV2 } from "#src/betting/dare-evaluator-v2.ts";
import { dareEvaluatorImplementationV2 } from "#src/betting/dare-evaluator-registry-v2.ts";
import type { DareMatchEvidenceV2 } from "#src/betting/dare-evidence-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  payDareV2TargetsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import type {
  DareFinalityV2,
  DareProofV2,
} from "#src/betting/dare-proof-v2.ts";
import { collectDareV2Batch } from "#src/betting/dare-settle-batch-v2.ts";
import {
  dareV2EvidenceCreateData,
  storedDareV2Evidence,
} from "#src/betting/dare-settle-evidence-v2.ts";
import {
  DareV2PartialSettlementError,
  type DareV2SettlementSummary,
} from "#src/betting/dare-settle-types-v2.ts";
import { settleDareV2OrVoidOnStorageOverflow } from "#src/betting/dare-settle-overflow-v2.ts";
import {
  darePlanNeedsTimeline,
  loadDareTimelineEvidenceV2,
} from "#src/betting/dare-timeline-evidence-v2.ts";
import {
  parseDareV2Contract,
  readableDareV2Contract,
} from "#src/betting/dare-v2-common.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dare-void-v2.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-settle-v2");
type ActiveDareV2Row = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;
async function freshFacts(
  tx: Db,
  input: {
    dareId: number;
    matchId?: string | undefined;
    serverId: string;
    potTotal: number;
    plainLanguage: string;
    targetAliases: string[];
  },
) {
  return await dareV2MoneyFactsInTransaction(tx, {
    dareId: input.dareId,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    serverId: input.serverId,
    potTotal: input.potTotal,
    targetAliases: input.targetAliases,
    conditionSummary: input.plainLanguage,
  });
}

async function resolveFinalDareV2(
  tx: Db,
  input: {
    dare: {
      id: number;
      serverId: string;
      potTotal: number;
      targets: readonly {
        id: number;
        targetKey: string;
        discordId: string;
        alias: string;
        bucksAccountId: number | null;
        acceptedAt: Date | null;
      }[];
    };
    contract: DareContractV2;
    matchId?: string | undefined;
    finality: DareFinalityV2;
    proof: DareProofV2 | null;
    now: Date;
  },
): Promise<"achieved" | "unachieved" | "voided"> {
  const value = input.finality.value;
  const resolution =
    value === true ? "achieved" : value === false ? "unachieved" : "voided";
  const settled = await tx.bucksDareV2.updateMany({
    where: { id: input.dare.id, dareState: "active" },
    data: {
      dareState: resolution,
      settledAt: input.now,
      finalValue: value,
      proofJson: input.proof === null ? null : JSON.stringify(input.proof),
      voidReason: value === null ? "missing_evidence" : null,
    },
  });
  if (settled.count !== 1) {
    throw new Error(
      `Dare v2 ${input.dare.id.toString()} lost its settlement claim.`,
    );
  }
  const facts = await freshFacts(tx, {
    dareId: input.dare.id,
    matchId: input.matchId,
    serverId: input.dare.serverId,
    potTotal: input.dare.potTotal,
    plainLanguage: input.contract.plainLanguage,
    targetAliases: input.dare.targets.map((target) => target.alias),
  });
  if (value === true) {
    if (input.proof === null)
      throw new Error("An achieved Dare v2 has no proof.");
    const targetKeys = new Set(input.proof.targetKeys);
    const payees = input.dare.targets
      .filter((target) => targetKeys.has(target.targetKey))
      .map((target) => {
        if (target.bucksAccountId === null || target.acceptedAt === null) {
          throw new Error(
            `Achieved Dare v2 target ${target.id.toString()} is not accepted.`,
          );
        }
        return {
          id: target.id,
          discordId: target.discordId,
          alias: target.alias,
          bucksAccountId: target.bucksAccountId,
        };
      });
    await payDareV2TargetsInTransaction(tx, { facts, targets: payees });
  } else {
    await refundDareV2ContributionsInTransaction(tx, {
      facts,
      resolution: value === null ? "voided" : "unachieved",
      withCut: value === false,
      ...(value === null ? { voidReason: "missing_evidence" } : {}),
    });
  }
  return resolution;
}

async function captureOneDareV2(
  tx: Db,
  input: {
    dare: ActiveDareV2Row;
    contract: DareContractV2;
    matchEvidence: DareMatchEvidenceV2;
    now: Date;
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
        `${input.contract.compilerVersion}:${input.contract.evaluatorVersion}`,
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
      })
    : "captured";
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

function matchTouchesContract(
  matchData: RawMatch,
  contract: DareContractV2,
): boolean {
  const puuids = new Set(
    matchData.info.participants.map((participant) => participant.puuid),
  );
  return contract.targets.some((target) =>
    target.accounts.some((account) => puuids.has(account.puuid)),
  );
}

async function inspectStoredContract(
  row: ActiveDareV2Row,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<
  | { kind: "valid"; contract: DareContractV2 }
  | { kind: "invalid"; summary: DareV2SettlementSummary | null }
> {
  const contract = readableDareV2Contract(row.contractJson);
  if (contract !== null) return { kind: "valid", contract };
  const voided = await voidDareV2WithFullRefund(
    row,
    "invalid_contract",
    prismaClient,
    now,
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

function matchSettlementContext(matchData: RawMatch) {
  if (classifyMatchForBetting(matchData).kind !== "decided") return null;
  const queue = resolveQueueTypeFromGame(
    matchData.info.queueId,
    matchData.info.gameMode,
    matchData.info.gameType,
  );
  if (queue === undefined) return null;
  return {
    queue,
    gameStartAt: new Date(matchData.info.gameStartTimestamp),
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
  };
}

function reportBatchFailure(
  stage: "inspect" | "settle",
  row: ActiveDareV2Row,
  matchId: string,
  error: unknown,
): void {
  logger.error(
    `Could not ${stage} Dare v2 ${row.id.toString()} for ${matchId}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: {
      source: `betting-dare-v2-${stage}`,
      matchId,
      dareId: row.id.toString(),
    },
  });
}

export async function settleDaresV2ForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  options: {
    now?: Date | undefined;
    timeline?: DareTimelineEvidenceV2 | undefined;
  } = {},
): Promise<DareV2SettlementSummary[]> {
  const now = options.now ?? new Date();
  const context = matchSettlementContext(matchData);
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
  const contracts: { row: ActiveDareV2Row; contract: DareContractV2 }[] = [];
  const inspected = await collectDareV2Batch(
    rows,
    async (row) => ({
      row,
      outcome: await inspectStoredContract(row, prismaClient, now),
    }),
    (row, error) => {
      reportBatchFailure("inspect", row, matchData.metadata.matchId, error);
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
    matchTouchesContract(matchData, contract),
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
  const needsTimeline = relevant.some(({ contract }) =>
    darePlanNeedsTimeline(contract.compiledPlan),
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
      const plan = DareCompiledPlanV2Schema.parse(contract.compiledPlan);
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
        },
        async () =>
          await prismaClient.$transaction(
            async (tx) =>
              await captureOneDareV2(tx, {
                dare: row,
                contract,
                matchEvidence,
                now,
              }),
          ),
      );
    },
    ({ row }, error) => {
      reportBatchFailure("settle", row, matchData.metadata.matchId, error);
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

export async function dareV2MatchNeedsTimeline(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const context = matchSettlementContext(matchData);
  if (context === null) return false;
  const rows = await prismaClient.bucksDareV2.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: context.gameStartAt },
      deadlineAt: { gte: context.gameEndAt },
    },
    select: { contractJson: true },
    orderBy: { id: "asc" },
  });
  return rows.some((row) => {
    const contract = readableDareV2Contract(row.contractJson);
    return (
      contract !== null &&
      matchTouchesContract(matchData, contract) &&
      darePlanNeedsTimeline(contract.compiledPlan)
    );
  });
}

export async function settleActiveDareV2AtBound(
  dare: ActiveDareV2Row,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareV2SettlementSummary | undefined> {
  if (dare.contractJson === null) {
    throw new Error(`Active Dare v2 ${dare.id.toString()} has no contract.`);
  }
  const contract = parseDareV2Contract(dare.contractJson);
  const evaluator = dareEvaluatorImplementationV2(contract.evaluatorVersion);
  return await settleDareV2OrVoidOnStorageOverflow(
    { dare, prismaClient, now },
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
              });
        const resolution = await resolveFinalDareV2(tx, {
          dare,
          contract,
          finality,
          proof,
          now,
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
