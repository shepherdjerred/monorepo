import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DareContractSchema,
  DareSqlCompilationSchema,
  LeaguePuuidSchema,
  resolveQueueTypeFromGame,
  type DareContract,
  type DareSqlEvidence,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  evaluateImprovementEvidence,
  evaluateRankEvidence,
} from "#src/betting/dares/lifecycle/dare-activation-evaluation.ts";
import type { Prisma } from "#generated/prisma/client/index.js";
import { isRemakeMatch } from "#src/betting/outcome.ts";
import { matchTouchesRelationalDare } from "#src/betting/dares/evaluation/dare-match-eligibility.ts";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import { dareMoneyFactsInTransaction } from "#src/betting/dares/settlement/dare-ledger.ts";
import { distributeDareResolution } from "#src/betting/dares/lifecycle/dare-resolution.ts";
import {
  announceOrWithholdDare,
  recordTerminalDareAnnouncement,
} from "#src/betting/dares/settlement/dare-announcement.ts";
import { claimActiveDareSettlement } from "#src/betting/dares/settlement/dare-settlement-claim.ts";
import {
  decisiveTargetDependencies,
  executeDareSql,
} from "#src/betting/dares/sql/dare-sql.ts";
import { enqueueMaterialDareProgressNotification } from "#src/betting/dares/presentation/notify/dare-notification-production.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import type {
  DareFinality,
  DareProof,
  DareSettlementSummary,
} from "#src/betting/dares/settlement/dare-settle-types.ts";
import { type Db, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getLatestRankAfterAndAtOrBefore } from "#src/league/model/rank-history.ts";

type ActiveRelationalDareRow = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;

function compilationForContract(contract: DareContract) {
  return DareSqlCompilationSchema.parse({
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

export function dareFinalityForEvidence(
  contract: Pick<
    DareContract,
    "competition" | "finality" | "maxEligibleGames"
  > & { activation?: DareContract["activation"] },
  evidence: DareSqlEvidence,
  deadlineReached: boolean,
  evidenceWatermark?: Date,
): DareFinality {
  if (deadlineReached) {
    return { value: evidence.achieved, final: true, reason: "deadline" };
  }
  if (contract.competition.kind === "race") {
    return dareRaceFinality(evidence, evidenceWatermark);
  }
  if (
    contract.activation?.kind !== "rank" &&
    contract.finality === "monotone_true" &&
    evidence.achieved === true
  ) {
    return { value: true, final: true, reason: "monotone_success" };
  }
  return evidence.sourceMatchIds.length >= contract.maxEligibleGames
    ? { value: evidence.achieved, final: true, reason: "game_cap" }
    : { value: evidence.achieved, final: false, reason: "reversible" };
}

export function dareRaceFinality(
  evidence: DareSqlEvidence,
  evidenceWatermark?: Date,
): DareFinality {
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
  contract: DareContract,
  evidence: DareSqlEvidence,
  targetKeys: string[],
  now: Date,
): DareProof | null {
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

async function resolveDare(
  tx: Db,
  input: {
    dare: ActiveRelationalDareRow;
    contract: DareContract;
    evidence: DareSqlEvidence;
    finality: DareFinality;
    proof: DareProof | null;
    now: Date;
    matchId?: RiotMatchId | undefined;
    /** Whether the match this settles is owed a public delivery. */
    notify: DareNotificationDisposition;
  },
): Promise<"achieved" | "unachieved" | "voided"> {
  const value = input.finality.value;
  const resolution = await claimActiveDareSettlement(tx, {
    dareId: input.dare.id,
    value,
    proof: input.proof,
    now: input.now,
    matchId: input.matchId,
  });
  const facts = await dareMoneyFactsInTransaction(tx, {
    dareId: input.dare.id,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    serverId: input.dare.serverId,
    targetAliases: input.dare.targets.map((target) => target.alias),
    conditionSummary: `${input.contract.queryHash}: ${input.contract.canonicalSql}`,
  });
  const settled = await distributeDareResolution(tx, {
    dare: input.dare,
    contract: input.contract,
    proof: input.proof,
    facts,
    value,
  });
  await recordTerminalDareAnnouncement(tx, input, resolution, settled);
  return resolution;
}

function evidenceCreateData(
  dareId: number,
  matchData: RawMatch,
  queueType: string,
  evidence: DareSqlEvidence,
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
  contract: DareContract,
  end: Date,
  prismaClient: ExtendedPrismaClient,
): Promise<DareSqlEvidence> {
  const sqlEvidence = await executeDareSql({
    compilation: compilationForContract(contract),
    targets: contract.targets,
    start: new Date(contract.activationAt),
    end,
  });
  if (contract.activation.kind === "improvement") {
    return evaluateImprovementEvidence(contract, sqlEvidence);
  }
  if (contract.activation.kind !== "rank") return sqlEvidence;
  const snapshots = contract.activationSnapshot?.targets.filter(
    (target) => target.kind === "rank",
  );
  if (snapshots?.length !== contract.targets.length) {
    throw new Error("Rank Dare is missing activation snapshots.");
  }
  const ranks = new Map<string, (typeof snapshots)[number]["baseline"]>();
  for (const snapshot of snapshots) {
    const current = await getLatestRankAfterAndAtOrBefore(
      LeaguePuuidSchema.parse(snapshot.sourcePuuid),
      contract.activation.queue,
      {
        afterTimestamp: new Date(contract.activationAt).getTime(),
        timestamp: end.getTime(),
      },
      prismaClient,
    );
    ranks.set(snapshot.targetKey, current ?? snapshot.baseline);
  }
  return evaluateRankEvidence(contract, sqlEvidence, ranks);
}

export function dareSqlUsesEvidenceTargetDependencies(
  contract: Pick<DareContract, "activation" | "competition">,
  evidence: Pick<DareSqlEvidence, "achieved">,
): boolean {
  return (
    evidence.achieved !== true ||
    contract.activation.kind !== "immediate" ||
    contract.competition.kind === "race"
  );
}

async function settlementTargetKeys(
  contract: DareContract,
  evidence: DareSqlEvidence,
  end: Date,
): Promise<string[]> {
  if (dareSqlUsesEvidenceTargetDependencies(contract, evidence)) {
    return evidence.targetDependencies;
  }
  return await decisiveTargetDependencies({
    compilation: compilationForContract(contract),
    targets: contract.targets,
    start: new Date(contract.activationAt),
    end,
  });
}

export function dareRaceEvaluationEnd(
  deadlineAt: string,
  evidenceWatermark: Date,
): Date {
  return new Date(
    Math.min(evidenceWatermark.getTime(), new Date(deadlineAt).getTime()),
  );
}

export async function captureDareSqlForMatch(input: {
  dare: ActiveRelationalDareRow;
  contract: DareContract;
  matchData: RawMatch;
  prismaClient: ExtendedPrismaClient;
  now: Date;
  /** Whether the match this settles is owed a public delivery. */
  notify: DareNotificationDisposition;
}): Promise<DareSettlementSummary | undefined> {
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
  const finality = dareFinalityForEvidence(contract, evidence, false);
  const targetKeys = await settlementTargetKeys(
    contract,
    evidence,
    new Date(matchData.info.gameEndTimestamp),
  );
  const proof = finality.final
    ? proofForEvidence(contract, evidence, targetKeys, now)
    : null;
  return await prismaClient.$transaction(async (tx) => {
    const claimed = await tx.bucksDare.updateMany({
      where: { id: dare.id, dareState: "active" },
      data: { updatedAt: now, ...pendingDareCalloutRefresh() },
    });
    if (claimed.count !== 1) return;
    const captured = await tx.bucksDareEvidence.createMany({
      data: [evidenceCreateData(dare.id, matchData, queue, evidence)],
      skipDuplicates: true,
    });
    if (captured.count !== 1) return;
    const rows = await tx.bucksDareEvidence.findMany({
      where: { dareId: dare.id },
      orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
    });
    const resolution = finality.final
      ? await resolveDare(tx, {
          dare,
          contract,
          evidence,
          finality,
          proof,
          now,
          matchId: matchData.metadata.matchId,
          notify: input.notify,
        })
      : "captured";
    if (resolution === "captured") {
      // Progress and a pending callout are both things this match would say,
      // and a backfill says neither.
      await announceOrWithholdDare(
        tx,
        { dareId: dare.id, notify: input.notify },
        async () => {
          await enqueueMaterialDareProgressNotification(tx, {
            dareId: dare.id,
            contract,
            evidence: rows,
            matchId: matchData.metadata.matchId,
            finality,
            now,
          });
        },
      );
    }
    return {
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

export async function settleDareSqlAtDeadline(
  dare: ActiveRelationalDareRow,
  contract: DareContract,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<DareSettlementSummary | undefined> {
  const evidence = await evaluateContract(
    contract,
    new Date(contract.deadlineAt),
    prismaClient,
  );
  const finality = dareFinalityForEvidence(contract, evidence, true);
  const targetKeys = await settlementTargetKeys(
    contract,
    evidence,
    new Date(contract.deadlineAt),
  );
  const proof = proofForEvidence(contract, evidence, targetKeys, now);
  return await prismaClient.$transaction(async (tx) => {
    const resolution = await resolveDare(tx, {
      dare,
      contract,
      evidence,
      finality,
      proof,
      now,
      // A deadline is not a match's announcement; nothing here is owed
      // silence by a delivery mode.
      notify: "enqueue",
    });
    return {
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

export async function settleMatureDareSqlRaces(
  prismaClient: ExtendedPrismaClient,
  evidenceWatermark: Date,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const rows = await prismaClient.bucksDare.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: evidenceWatermark },
    },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const summaries: DareSettlementSummary[] = [];
  const failures: unknown[] = [];
  for (const row of rows) {
    try {
      if (row.contractJson === null) continue;
      const raw: unknown = JSON.parse(row.contractJson);
      const parsed = DareContractSchema.safeParse(raw);
      if (!parsed.success || parsed.data.competition.kind !== "race") continue;
      const contract = parsed.data;
      const evaluationEnd = dareRaceEvaluationEnd(
        contract.deadlineAt,
        evidenceWatermark,
      );
      const evidence = await evaluateContract(
        contract,
        evaluationEnd,
        prismaClient,
      );
      const finality = dareFinalityForEvidence(
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
        const resolution = await resolveDare(tx, {
          dare: row,
          contract,
          evidence,
          finality,
          proof,
          now,
          // Deadline-driven, like its sibling above: a matured race resolves
          // on the clock rather than on a match being delivered, so no
          // delivery mode is in play and nothing here is owed silence.
          notify: "enqueue",
        });
        return {
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
      `${failures.length.toString()} Dare race settlements failed.`,
    );
  }
  return summaries;
}
