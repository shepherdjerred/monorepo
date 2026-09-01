import {
  DareCompiledPlanV2Schema,
  DareContractV2Schema,
  resolveQueueTypeFromGame,
  type DareContractV2,
  type RawMatch,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import type { DareTimelineEvidenceV2 } from "#src/betting/dare-evaluator-v2.ts";
import { dareEvaluatorImplementationV2 } from "#src/betting/dare-evaluator-registry-v2.ts";
import {
  DareMatchEvidenceV2Schema,
  type DareMatchEvidenceV2,
} from "#src/betting/dare-evidence-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  payDareV2TargetsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import type {
  DareFinalityV2,
  DareProofV2,
} from "#src/betting/dare-proof-v2.ts";
import {
  darePlanNeedsTimeline,
  loadDareTimelineEvidenceV2,
} from "#src/betting/dare-timeline-evidence-v2.ts";
import { parseDareV2Contract } from "#src/betting/dare-v2-common.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dare-void-v2.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";

export type DareV2SettlementSummary = {
  contractVersion: 2;
  dareId: number;
  serverId: string;
  channelId: string;
  matchId?: string | undefined;
  resolution: "captured" | "achieved" | "unachieved" | "voided";
  value: boolean | null;
  finality: DareFinalityV2;
  proof: DareProofV2 | null;
};

type ActiveDareV2Row = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

function storedEvidence(row: {
  matchId: string;
  gameStartAt: Date;
  gameEndAt: Date;
  queueType: string;
  candidateMembership: string;
  evaluationOutput: string;
  coverageState: string;
  targetDependencies: string;
  sourceReferences: string;
  evaluationTrace: string;
}): DareMatchEvidenceV2 {
  const output: unknown = JSON.parse(row.evaluationOutput);
  if (typeof output !== "object" || output === null) {
    throw new Error(
      `Dare v2 evidence ${row.matchId} has invalid evaluation output.`,
    );
  }
  return DareMatchEvidenceV2Schema.parse({
    matchId: row.matchId,
    gameStartAt: row.gameStartAt.toISOString(),
    gameEndAt: row.gameEndAt.toISOString(),
    queue: row.queueType,
    candidateSets: JSON.parse(row.candidateMembership),
    ...output,
    coverageState: row.coverageState,
    targetDependencies: JSON.parse(row.targetDependencies),
    sourceReferences: JSON.parse(row.sourceReferences),
    evaluationTrace: JSON.parse(row.evaluationTrace),
  });
}

function evidenceCreateData(
  dareId: number,
  evidence: DareMatchEvidenceV2,
  planVersion: string,
) {
  return {
    dareId,
    matchId: evidence.matchId,
    gameStartAt: new Date(evidence.gameStartAt),
    gameEndAt: new Date(evidence.gameEndAt),
    queueType: evidence.queue,
    candidateMembership: JSON.stringify(evidence.candidateSets),
    sourceReferences: JSON.stringify(evidence.sourceReferences),
    evaluationOutput: JSON.stringify({
      setResults: evidence.setResults,
      setValues: evidence.setValues,
    }),
    coverageState: evidence.coverageState,
    targetDependencies: JSON.stringify(evidence.targetDependencies),
    evaluationTrace: JSON.stringify(evidence.evaluationTrace),
    planVersion,
  };
}

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
    data: { updatedAt: input.now },
  });
  if (claim.count !== 1) return undefined;
  const captured = await tx.bucksDareV2Evidence.createMany({
    data: [
      evidenceCreateData(
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
  const evidence = rows.map((row) => storedEvidence(row));
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

function readableContract(raw: string | null): DareContractV2 | null {
  if (raw === null) return null;
  try {
    return DareContractV2Schema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

async function inspectStoredContract(
  row: ActiveDareV2Row,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<
  | { kind: "valid"; contract: DareContractV2 }
  | { kind: "invalid"; summary: DareV2SettlementSummary | null }
> {
  const contract = readableContract(row.contractJson);
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
  for (const row of rows) {
    const inspected = await inspectStoredContract(row, prismaClient, now);
    if (inspected.kind === "valid") {
      contracts.push({ row, contract: inspected.contract });
    } else {
      if (inspected.summary !== null) summaries.push(inspected.summary);
    }
  }
  const relevant = contracts.filter(({ contract }) =>
    matchTouchesContract(matchData, contract),
  );
  if (relevant.length === 0) return summaries;
  const needsTimeline = relevant.some(({ contract }) =>
    darePlanNeedsTimeline(contract.compiledPlan),
  );
  const timeline: DareTimelineEvidenceV2 =
    options.timeline ??
    (needsTimeline
      ? await loadDareTimelineEvidenceV2(matchData.metadata.matchId)
      : { coverage: "missing", events: [], participants: [] });
  for (const { row, contract } of relevant) {
    const plan = DareCompiledPlanV2Schema.parse(contract.compiledPlan);
    const evaluator = dareEvaluatorImplementationV2(contract.evaluatorVersion);
    const matchEvidence = evaluator.evaluateMatch({
      plan,
      targets: contract.targets,
      matchData,
      queue: context.queue,
      timeline,
    });
    if (!Object.values(matchEvidence.candidateSets).some(Boolean)) continue;
    const summary = await prismaClient.$transaction(
      async (tx) =>
        await captureOneDareV2(tx, {
          dare: row,
          contract,
          matchEvidence,
          now,
        }),
    );
    if (summary !== undefined) summaries.push(summary);
  }
  return summaries;
}

/** Whether the live post-match path must retain a timeline before v2 capture. */
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
    const contract = readableContract(row.contractJson);
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
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDareV2.updateMany({
      where: { id: dare.id, dareState: "active" },
      data: { updatedAt: now },
    });
    if (claim.count !== 1) return;
    const rows = await tx.bucksDareV2Evidence.findMany({
      where: { dareId: dare.id },
      orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
    });
    const evidence = rows.map((row) => storedEvidence(row));
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
  });
}
