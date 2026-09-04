import {
  ChallengeContractV1Schema,
  LeaguePuuidSchema,
  MatchIdSchema,
  challengeNeedsTimeline,
  type LeaguePuuid,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  scoutChallengeRunRecomputeWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { launchChallengeRunRecompute } from "#src/progression/challenges/launch.ts";
import { ChallengeSelectedAccountsSchema } from "#src/progression/challenges/run-store.ts";
import { parseProgressionJson } from "#src/progression/json.ts";

export async function challengeMatchNeedsTimeline(
  participantPuuids: readonly LeaguePuuid[],
  db: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const cursorMatch = await db.challengeRunCursor.findFirst({
    where: {
      puuid: { in: [...participantPuuids] },
      timelineRequired: true,
      run: { activePointer: { isNot: null } },
    },
    select: { runId: true },
  });
  if (cursorMatch !== null) return true;
  const initializingRuns = await db.challengeRun.findMany({
    where: { activePointer: { isNot: null } },
    select: {
      frozenContractJson: true,
      revisions: {
        orderBy: { revision: "desc" },
        take: 1,
        select: { selectedAccountsJson: true },
      },
    },
  });
  const participants = new Set(participantPuuids);
  return initializingRuns.some((run) => {
    const contract = parseProgressionJson(
      run.frozenContractJson,
      ChallengeContractV1Schema,
    );
    const revision = run.revisions[0];
    if (
      revision === undefined ||
      !challengeNeedsTimeline(contract.matchPredicate)
    ) {
      return false;
    }
    return parseProgressionJson(
      revision.selectedAccountsJson,
      ChallengeSelectedAccountsSchema,
    ).some((account) => participants.has(account.puuid));
  });
}

export async function challengeRunIdsForMatch(
  participantPuuids: readonly LeaguePuuid[],
  db: ExtendedPrismaClient = prisma,
): Promise<Set<string>> {
  const [cursors, recomputingRuns] = await Promise.all([
    db.challengeRunCursor.findMany({
      where: {
        puuid: { in: [...participantPuuids] },
        run: { activePointer: { isNot: null } },
      },
      select: { runId: true },
    }),
    // A run has no current cursor during its initial evaluation, and an
    // account edit deliberately leaves the previous cursor visible until the
    // replacement snapshot commits. Consult the newest frozen selection while
    // recomputation is active so a match landing in either window cannot be
    // omitted permanently.
    db.challengeRun.findMany({
      where: { activePointer: { isNot: null }, recomputing: true },
      select: {
        id: true,
        revisions: {
          orderBy: { revision: "desc" },
          take: 1,
          select: { selectedAccountsJson: true },
        },
      },
    }),
  ]);
  const participants = new Set(participantPuuids);
  const runIds = new Set(cursors.map((cursor) => cursor.runId));
  for (const run of recomputingRuns) {
    const revision = run.revisions[0];
    if (
      revision !== undefined &&
      parseProgressionJson(
        revision.selectedAccountsJson,
        ChallengeSelectedAccountsSchema,
      ).some((account) => participants.has(account.puuid))
    ) {
      runIds.add(run.id);
    }
  }
  return runIds;
}

async function createMatchRevision(
  runId: string,
  matchId: ReturnType<typeof MatchIdSchema.parse>,
  stage: ScoutStage,
): Promise<{ readonly runId: string; readonly revision: number } | null> {
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ChallengeRun" WHERE "id" = ${runId} FOR UPDATE`;
    const existing = await tx.challengeRunMatchTrigger.findUnique({
      where: { runId_matchId: { runId, matchId } },
    });
    if (existing !== null) {
      const [run, revision] = await Promise.all([
        tx.challengeRun.findUniqueOrThrow({
          where: { id: runId },
          include: { activePointer: true },
        }),
        tx.challengeRunRevision.findUniqueOrThrow({
          where: {
            runId_revision: { runId, revision: existing.revision },
          },
        }),
      ]);
      if (
        run.activePointer === null ||
        run.evaluationRevision !== existing.revision ||
        revision.revisionState === "ready" ||
        revision.revisionState === "stale"
      ) {
        return null;
      }
      return { runId, revision: existing.revision };
    }
    const current = await tx.challengeRun.findUniqueOrThrow({
      where: { id: runId },
      include: { activePointer: true },
    });
    if (current.activePointer === null) return null;
    const priorRevision = await tx.challengeRunRevision.findUniqueOrThrow({
      where: {
        runId_revision: {
          runId,
          revision: current.evaluationRevision,
        },
      },
    });
    const updated = await tx.challengeRun.update({
      where: { id: runId },
      data: { evaluationRevision: { increment: 1 }, recomputing: true },
    });
    const workflowId = scoutChallengeRunRecomputeWorkflowId(
      stage,
      runId,
      updated.evaluationRevision,
    );
    await tx.challengeRunRevision.create({
      data: {
        runId,
        revision: updated.evaluationRevision,
        selectedAccountsJson: priorRevision.selectedAccountsJson,
        workflowId,
      },
    });
    await tx.challengeRunMatchTrigger.create({
      data: { runId, matchId, revision: updated.evaluationRevision },
    });
    return { runId, revision: updated.evaluationRevision };
  });
}

export async function updateChallengeRunsForMatch(
  match: RawMatch,
  stage: ScoutStage,
): Promise<void> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const runIds = await challengeRunIdsForMatch(
    match.metadata.participants.map((puuid) => LeaguePuuidSchema.parse(puuid)),
  );
  for (const runId of runIds) {
    const revision = await createMatchRevision(runId, matchId, stage);
    if (revision === null) continue;
    await launchChallengeRunRecompute({ stage, ...revision });
  }
}
