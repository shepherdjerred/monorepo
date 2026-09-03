import {
  DareSqlV3CompilationSchema,
  resolveQueueTypeFromGame,
  type DareContractV3,
  type DareSqlV3Evidence,
  type RawMatch,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { isRemakeMatch } from "#src/betting/outcome.ts";
import { matchTouchesRelationalDare } from "#src/betting/dare-match-eligibility.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  payDareV2TargetsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import {
  decisiveTargetDependenciesV3,
  executeDareSqlV3,
} from "#src/betting/dare-sql-v3.ts";
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
  });
}

function finalityForEvidence(
  contract: DareContractV3,
  evidence: DareSqlV3Evidence,
  deadlineReached: boolean,
): DareFinalityV2 {
  if (deadlineReached) {
    return { value: evidence.achieved, final: true, reason: "deadline" };
  }
  if (contract.finality === "monotone_true" && evidence.achieved === true) {
    return { value: true, final: true, reason: "monotone_success" };
  }
  if (evidence.sourceMatchIds.length >= contract.maxEligibleGames) {
    return { value: evidence.achieved, final: true, reason: "game_cap" };
  }
  return { value: evidence.achieved, final: false, reason: "reversible" };
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
  if (value === true) {
    if (input.proof === null)
      throw new Error("An achieved Dare v3 has no proof.");
    const payeeKeys = new Set(input.proof.targetKeys);
    const payees = input.dare.targets
      .filter((target) => payeeKeys.has(target.targetKey))
      .map((target) => {
        if (target.bucksAccountId === null || target.acceptedAt === null) {
          throw new Error(
            `Achieved Dare v3 target ${target.id.toString()} is not accepted.`,
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
    ]),
    planVersion: "dare-sql-evaluator-3",
  };
}

async function evaluateContract(
  contract: DareContractV3,
  end: Date,
): Promise<DareSqlV3Evidence> {
  return await executeDareSqlV3({
    compilation: compilationForContract(contract),
    targets: contract.targets,
    start: new Date(contract.activationAt),
    end,
  });
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
  );
  const finality = finalityForEvidence(contract, evidence, false);
  const targetKeys =
    evidence.achieved === true
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
  );
  const finality = finalityForEvidence(contract, evidence, true);
  const targetKeys =
    evidence.achieved === true
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
