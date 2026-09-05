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
    where: {
      activePointer: { isNot: null },
      OR: [{ recomputing: true }, { cursors: { none: {} } }],
    },
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

export type PreparedChallengeRun = {
  readonly runId: string;
  readonly revision: number;
  readonly timelineRequired: boolean;
};

function timelineRequirementForRevision(
  frozenContractJson: string,
  selectedAccountsJson: string,
  participantPuuids: readonly LeaguePuuid[],
): boolean | null {
  const participants = new Set(participantPuuids);
  const accounts = parseProgressionJson(
    selectedAccountsJson,
    ChallengeSelectedAccountsSchema,
  );
  if (!accounts.some((account) => participants.has(account.puuid))) return null;
  const contract = parseProgressionJson(
    frozenContractJson,
    ChallengeContractV1Schema,
  );
  return challengeNeedsTimeline(contract.matchPredicate);
}

async function createMatchRevision(
  db: ExtendedPrismaClient,
  options: {
    readonly runId: string;
    readonly matchId: ReturnType<typeof MatchIdSchema.parse>;
    readonly stage: ScoutStage;
    readonly participantPuuids: readonly LeaguePuuid[];
  },
): Promise<PreparedChallengeRun | null> {
  return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ChallengeRun" WHERE "id" = ${options.runId} FOR UPDATE`;
    const current = await tx.challengeRun.findUniqueOrThrow({
      where: { id: options.runId },
      include: { activePointer: true },
    });
    if (current.activePointer === null) return null;
    const existing = await tx.challengeRunMatchTrigger.findUnique({
      where: {
        runId_matchId: { runId: options.runId, matchId: options.matchId },
      },
    });
    if (existing !== null && current.evaluationRevision === existing.revision) {
      const revision = await tx.challengeRunRevision.findUniqueOrThrow({
        where: {
          runId_revision: {
            runId: options.runId,
            revision: existing.revision,
          },
        },
      });
      if (
        revision.revisionState === "ready" ||
        revision.revisionState === "stale"
      ) {
        return null;
      }
      const timelineRequired = timelineRequirementForRevision(
        current.frozenContractJson,
        revision.selectedAccountsJson,
        options.participantPuuids,
      );
      return timelineRequired === null
        ? null
        : {
            runId: options.runId,
            revision: existing.revision,
            timelineRequired,
          };
    }
    if (existing !== null) {
      await tx.challengeRunRevision.updateMany({
        where: {
          runId: options.runId,
          revision: existing.revision,
          revisionState: "waiting_for_evidence",
        },
        data: { revisionState: "stale", completedAt: new Date() },
      });
    }
    const priorRevision = await tx.challengeRunRevision.findUniqueOrThrow({
      where: {
        runId_revision: {
          runId: options.runId,
          revision: current.evaluationRevision,
        },
      },
    });
    const timelineRequired = timelineRequirementForRevision(
      current.frozenContractJson,
      priorRevision.selectedAccountsJson,
      options.participantPuuids,
    );
    if (timelineRequired === null) return null;
    const updated = await tx.challengeRun.update({
      where: { id: options.runId },
      data: { evaluationRevision: { increment: 1 }, recomputing: true },
    });
    const workflowId = scoutChallengeRunRecomputeWorkflowId(
      options.stage,
      options.runId,
      updated.evaluationRevision,
    );
    await tx.challengeRunRevision.create({
      data: {
        runId: options.runId,
        revision: updated.evaluationRevision,
        selectedAccountsJson: priorRevision.selectedAccountsJson,
        revisionState: "waiting_for_evidence",
        workflowId,
      },
    });
    await tx.challengeRunMatchTrigger.upsert({
      where: {
        runId_matchId: { runId: options.runId, matchId: options.matchId },
      },
      create: {
        runId: options.runId,
        matchId: options.matchId,
        revision: updated.evaluationRevision,
      },
      update: { revision: updated.evaluationRevision },
    });
    return {
      runId: options.runId,
      revision: updated.evaluationRevision,
      timelineRequired,
    };
  });
}

export async function prepareChallengeRunsForMatch(
  match: RawMatch,
  stage: ScoutStage,
  db: ExtendedPrismaClient = prisma,
): Promise<readonly PreparedChallengeRun[]> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const participantPuuids = match.metadata.participants.map((puuid) =>
    LeaguePuuidSchema.parse(puuid),
  );
  const runIds = await challengeRunIdsForMatch(participantPuuids, db);
  const revisions: PreparedChallengeRun[] = [];
  for (const runId of runIds) {
    const revision = await createMatchRevision(db, {
      runId,
      matchId,
      stage,
      participantPuuids,
    });
    if (revision === null) continue;
    revisions.push(revision);
  }
  return revisions;
}

export async function queuePreparedChallengeRuns(
  revisions: readonly PreparedChallengeRun[],
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const revision of revisions) {
      await tx.challengeRunRevision.updateMany({
        where: {
          runId: revision.runId,
          revision: revision.revision,
          revisionState: "waiting_for_evidence",
        },
        data: { revisionState: "queued" },
      });
    }
  });
}

export async function launchPreparedChallengeRuns(
  stage: ScoutStage,
  revisions: readonly PreparedChallengeRun[],
): Promise<void> {
  for (const revision of revisions) {
    await launchChallengeRunRecompute({
      stage,
      runId: revision.runId,
      revision: revision.revision,
    });
  }
}
