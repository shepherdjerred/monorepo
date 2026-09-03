import {
  DareContractV3Schema,
  DareSqlV3CompilationSchema,
  RankSchema,
  resolveQueueTypeFromGame,
  type DareContractV3,
  type DareSqlV3Evidence,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  evaluateImprovementEvidenceV3,
  evaluateRankEvidenceV3,
} from "#src/betting/dare-activation-evaluation-v3.ts";
import type { Prisma } from "#generated/prisma/client/index.js";
import { isRemakeMatch } from "#src/betting/outcome.ts";
import { matchTouchesRelationalDare } from "#src/betting/dare-match-eligibility.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import { dareV2MoneyFactsInTransaction } from "#src/betting/dare-ledger-v2.ts";
import { distributeDareResolutionV3 } from "#src/betting/dare-resolution-v3.ts";
import {
  decisiveTargetDependenciesV3,
  executeDareSqlV3,
} from "#src/betting/dare-sql-v3.ts";
import {
  enqueueMaterialDareProgressNotificationV3,
  enqueueTerminalDareNotification,
} from "#src/betting/dare-notification-production.ts";
import type {
  DareProofV3,
  DareV2SettlementSummary,
} from "#src/betting/dare-settle-types-v2.ts";
import type { DareFinalityV2 } from "#src/betting/dare-proof-v2.ts";
import { type Db, type ExtendedPrismaClient } from "#src/database/index.ts";

type ActiveRelationalDareRow = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

function compilationForContract(contract: DareContractV3) {
  return DareSqlV3CompilationSchema.parse({
    compilerVersion: contract.compilerVersion,
    canonicalSql: contract.canonicalSql,
    immutableAst: contract.immutableAst,
    queryHash: contract.queryHash,
    maxEligibleGames: contract.maxEligibleGames,
    facts: contract.facts,
    resultStructure: contract.resultStructure,
    finality: contract.finality,
    competition: contract.competition,
    activation: contract.activation,
  });
}

function finalityForEvidence(
  contract: DareContractV3,
  evidence: DareSqlV3Evidence,
  deadlineReached: boolean,
  evidenceWatermark?: Date,
): DareFinalityV2 {
  if (deadlineReached) {
    return { value: evidence.achieved, final: true, reason: "deadline" };
  }
  if (contract.competition.kind === "race") {
    return dareRaceFinalityV3(evidence, evidenceWatermark);
  }
  if (contract.activation.kind !== "immediate" && evidence.achieved === true) {
    return { value: true, final: true, reason: "monotone_success" };
  }
  if (contract.finality === "monotone_true" && evidence.achieved === true) {
    return { value: true, final: true, reason: "monotone_success" };
  }
  if (evidence.sourceMatchIds.length >= contract.maxEligibleGames) {
    return { value: evidence.achieved, final: true, reason: "game_cap" };
  }
  return { value: evidence.achieved, final: false, reason: "reversible" };
}

export function dareRaceFinalityV3(
  evidence: DareSqlV3Evidence,
  evidenceWatermark?: Date,
): DareFinalityV2 {
  const qualifyingAt = evidence.race?.qualifyingGameEndAt;
  const final =
    qualifyingAt != null &&
    evidenceWatermark !== undefined &&
    evidenceWatermark.getTime() > new Date(qualifyingAt).getTime();
  return {
    value: evidence.achieved,
    final,
    reason: final ? "evidence_watermark" : "reversible",
  };
}

function proofForEvidence(
  contract: DareContractV3,
  evidence: DareSqlV3Evidence,
  targetKeys: string[],
  now: Date,
): DareProofV3 | null {
  if (evidence.achieved === null || evidence.coverage === "missing_timeline") {
    return null;
  }
  return {
    planVersion: 3,
    compilerVersion: contract.compilerVersion,
    evaluatorVersion: contract.evaluatorVersion,
    queryHash: contract.queryHash,
    value: evidence.achieved,
    decisiveAt: now.toISOString(),
    qualifyingMatchIds: evidence.sourceMatchIds,
    targetKeys,
    coverage: evidence.coverage,
  };
}

async function resolveV3(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContractV3;
    evidence: DareSqlV3Evidence;
    finality: DareFinalityV2;
    proof: DareProofV3 | null;
    now: Date;
    matchId?: string | undefined;
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
      ...pendingDareV2CalloutRefresh(),
    },
  });
  if (settled.count !== 1) {
    throw new Error(
      `Dare v3 ${input.dare.id.toString()} lost its settlement claim.`,
    );
  }
  const facts = await dareV2MoneyFactsInTransaction(tx, {
    dareId: input.dare.id,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    serverId: input.dare.serverId,
    potTotal: input.dare.potTotal,
    targetAliases: input.dare.targets.map((target) => target.alias),
    conditionSummary: input.contract.plainLanguage,
  });
  await distributeDareResolutionV3(tx, {
    dare: input.dare,
    contract: input.contract,
    proof: input.proof,
    facts,
    value,
  });
  await enqueueTerminalDareNotification(tx, {
    dareId: input.dare.id,
    revision: input.contract.revision,
    potTotal: input.dare.potTotal,
    resolution,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    now: input.now,
  });
  return resolution;
}

function evidenceCreateData(
  dareId: number,
  matchData: RawMatch,
  queueType: string,
  evidence: DareSqlV3Evidence,
) {
  return {
    dareId,
    matchId: matchData.metadata.matchId,
    gameStartAt: new Date(matchData.info.gameStartTimestamp),
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
    queueType,
    candidateMembership: JSON.stringify(evidence.sourceMatchIds),
    sourceReferences: JSON.stringify(
      evidence.sourceMatchIds.map((matchId) => ({ matchId })),
    ),
    evaluationOutput: JSON.stringify(evidence),
    coverageState: evidence.coverage,
    targetDependencies: JSON.stringify(evidence.targetDependencies),
    evaluationTrace: JSON.stringify([
      `Executed immutable Dare SQL ${evidence.queryHash}.`,
      `Resolved ${evidence.results.length.toString()} game-set rows and retained ${evidence.timelineEvents.length.toString()} relevant timeline events.`,
    ]),
    planVersion: "dare-evaluator-3",
  };
}

async function evaluateContract(
  contract: DareContractV3,
  end: Date,
  prismaClient: ExtendedPrismaClient,
): Promise<DareSqlV3Evidence> {
  const sqlEvidence = await executeDareSqlV3({
    compilation: compilationForContract(contract),
    targets: contract.targets,
    start: new Date(contract.activationAt),
    end,
  });
  if (contract.activation.kind === "improvement") {
    return evaluateImprovementEvidenceV3(contract, sqlEvidence);
  }
  if (contract.activation.kind !== "rank") return sqlEvidence;
  const snapshots = contract.activationSnapshot?.targets.filter(
    (target) => target.kind === "rank",
  );
  if (snapshots?.length !== contract.targets.length) {
    throw new Error("Rank Dare is missing activation snapshots.");
  }
  const stored = await prismaClient.currentRankSnapshot.findMany({
    where: { puuid: { in: snapshots.map((snapshot) => snapshot.sourcePuuid) } },
  });
  const ranks = new Map<string, ReturnType<typeof RankSchema.parse>>();
  for (const snapshot of snapshots) {
    const row = stored.find(
      (candidate) => candidate.puuid === snapshot.sourcePuuid,
    );
    if (row === undefined) continue;
    const serialized =
      contract.activation.queue === "solo" ? row.soloRank : row.flexRank;
    if (serialized !== null) {
      ranks.set(snapshot.targetKey, RankSchema.parse(JSON.parse(serialized)));
    }
  }
  return evaluateRankEvidenceV3(contract, sqlEvidence, ranks);
}

export async function captureDareSqlV3ForMatch(input: {
  dare: ActiveRelationalDareRow;
  contract: DareContractV3;
  matchData: RawMatch;
  prismaClient: ExtendedPrismaClient;
  now: Date;
}): Promise<DareV2SettlementSummary | undefined> {
  const { dare, contract, matchData, prismaClient, now } = input;
  if (
    isRemakeMatch(matchData) ||
    !matchTouchesRelationalDare(matchData, contract)
  ) {
    return undefined;
  }
  const queue = resolveQueueTypeFromGame(
    matchData.info.queueId,
    matchData.info.gameMode,
    matchData.info.gameType,
  );
  if (queue === undefined) return undefined;
  const evidence = await evaluateContract(
    contract,
    new Date(matchData.info.gameEndTimestamp),
    prismaClient,
  );
  const finality = finalityForEvidence(contract, evidence, false);
  const targetKeys =
    evidence.achieved === true && contract.activation.kind === "immediate"
      ? await decisiveTargetDependenciesV3({
          compilation: compilationForContract(contract),
          targets: contract.targets,
          start: new Date(contract.activationAt),
          end: new Date(matchData.info.gameEndTimestamp),
        })
      : evidence.targetDependencies;
  const proof = finality.final
    ? proofForEvidence(contract, evidence, targetKeys, now)
    : null;
  return await prismaClient.$transaction(async (tx) => {
    const claimed = await tx.bucksDareV2.updateMany({
      where: { id: dare.id, dareState: "active" },
      data: { updatedAt: now, ...pendingDareV2CalloutRefresh() },
    });
    if (claimed.count !== 1) return;
    const captured = await tx.bucksDareV2Evidence.createMany({
      data: [evidenceCreateData(dare.id, matchData, queue, evidence)],
      skipDuplicates: true,
    });
    if (captured.count !== 1) return;
    const rows = await tx.bucksDareV2Evidence.findMany({
      where: { dareId: dare.id },
      orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
    });
    const resolution = finality.final
      ? await resolveV3(tx, {
          dare,
          contract,
          evidence,
          finality,
          proof,
          now,
          matchId: matchData.metadata.matchId,
        })
      : "captured";
    if (resolution === "captured") {
      await enqueueMaterialDareProgressNotificationV3(tx, {
        dareId: dare.id,
        contract,
        evidence: rows,
        matchId: matchData.metadata.matchId,
        finality,
        now,
      });
    }
    return {
      contractVersion: 3,
      dareId: dare.id,
      serverId: dare.serverId,
      channelId: dare.channelId,
      matchId: matchData.metadata.matchId,
      resolution,
      value: finality.value,
      finality,
      proof,
    };
  });
}

export async function settleDareSqlV3AtDeadline(
  dare: ActiveRelationalDareRow,
  contract: DareContractV3,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<DareV2SettlementSummary | undefined> {
  const evidence = await evaluateContract(
    contract,
    new Date(contract.deadlineAt),
    prismaClient,
  );
  const finality = finalityForEvidence(contract, evidence, true);
  const targetKeys =
    evidence.achieved === true && contract.activation.kind === "immediate"
      ? await decisiveTargetDependenciesV3({
          compilation: compilationForContract(contract),
          targets: contract.targets,
          start: new Date(contract.activationAt),
          end: new Date(contract.deadlineAt),
        })
      : evidence.targetDependencies;
  const proof = proofForEvidence(contract, evidence, targetKeys, now);
  return await prismaClient.$transaction(async (tx) => {
    const resolution = await resolveV3(tx, {
      dare,
      contract,
      evidence,
      finality,
      proof,
      now,
    });
    return {
      contractVersion: 3,
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

export async function settleMatureDareSqlV3Races(
  prismaClient: ExtendedPrismaClient,
  evidenceWatermark: Date,
  now: Date = new Date(),
): Promise<DareV2SettlementSummary[]> {
  const rows = await prismaClient.bucksDareV2.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: evidenceWatermark },
    },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const summaries: DareV2SettlementSummary[] = [];
  const failures: unknown[] = [];
  for (const row of rows) {
    try {
      if (row.contractJson === null) continue;
      const raw: unknown = JSON.parse(row.contractJson);
      const parsed = DareContractV3Schema.safeParse(raw);
      if (!parsed.success || parsed.data.competition.kind !== "race") continue;
      const contract = parsed.data;
      const evidence = await evaluateContract(
        contract,
        evidenceWatermark,
        prismaClient,
      );
      const finality = finalityForEvidence(
        contract,
        evidence,
        false,
        evidenceWatermark,
      );
      if (!finality.final) continue;
      const proof = proofForEvidence(
        contract,
        evidence,
        evidence.targetDependencies,
        now,
      );
      const summary = await prismaClient.$transaction(async (tx) => {
        const resolution = await resolveV3(tx, {
          dare: row,
          contract,
          evidence,
          finality,
          proof,
          now,
        });
        return {
          contractVersion: 3 as const,
          dareId: row.id,
          serverId: row.serverId,
          channelId: row.channelId,
          resolution,
          value: finality.value,
          finality,
          proof,
        };
      });
      summaries.push(summary);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length.toString()} Dare v3 race settlements failed.`,
    );
  }
  return summaries;
}
