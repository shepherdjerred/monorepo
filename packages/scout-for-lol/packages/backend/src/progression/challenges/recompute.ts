import {
  ChallengeContractV1Schema,
  ChallengeCoverageSchema,
  ChallengeEvidenceMatchSchema,
  ChallengeProgressSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  challengeNeedsTimeline,
  evaluateChallengeContract,
} from "@scout-for-lol/data";
import type {
  ScoutChallengeRunRecomputeInput,
  ScoutChallengeRunRecomputePageResult,
} from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { fetchChallengeEvidence } from "#src/progression/challenges/evidence.ts";
import { ChallengeSelectedAccountsSchema } from "#src/progression/challenges/run-store.ts";
import { parseProgressionJson } from "#src/progression/json.ts";
import {
  challengeMissingTimelineMatches,
  challengeRecomputeDuration,
  challengeRunCompletions,
} from "#src/metrics/progression.ts";

const PAGE_SIZE = 250;

function progressCompleted(
  progress: ReturnType<typeof ChallengeProgressSchema.parse>,
): boolean {
  return progress.completed;
}

async function markRevisionFailure(
  input: ScoutChallengeRunRecomputeInput,
  error: unknown,
): Promise<void> {
  const revision = await prisma.challengeRunRevision.findUnique({
    where: {
      runId_revision: { runId: input.runId, revision: input.revision },
    },
    select: { startedAt: true, createdAt: true },
  });
  await prisma.$transaction([
    prisma.challengeRunRevision.updateMany({
      where: { runId: input.runId, revision: input.revision },
      data: {
        revisionState: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    }),
    prisma.challengeRun.updateMany({
      where: {
        id: input.runId,
        evaluationRevision: input.revision,
        runState: { not: "archived" },
      },
      data: { runState: "failed", recomputing: false },
    }),
  ]);
  const startedAt = revision?.startedAt ?? revision?.createdAt;
  if (startedAt !== undefined) {
    challengeRecomputeDuration.observe(
      { status: "failed" },
      (Date.now() - startedAt.getTime()) / 1000,
    );
  }
}

async function finalizeRevision(
  input: ScoutChallengeRunRecomputeInput,
): Promise<void> {
  const [run, revisionForMetrics] = await Promise.all([
    prisma.challengeRun.findUniqueOrThrow({ where: { id: input.runId } }),
    prisma.challengeRunRevision.findUniqueOrThrow({
      where: {
        runId_revision: { runId: input.runId, revision: input.revision },
      },
    }),
  ]);
  const contract = parseProgressionJson(
    run.frozenContractJson,
    ChallengeContractV1Schema,
  );
  const rows = await prisma.challengeRunEvidence.findMany({
    where: { runId: input.runId, revision: input.revision },
    orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }, { puuid: "asc" }],
  });
  const evaluated = evaluateChallengeContract(
    contract,
    rows.map((row) =>
      parseProgressionJson(row.evidenceJson, ChallengeEvidenceMatchSchema),
    ),
    { startAt: run.originalStartAt.toISOString(), endAt: null },
  );
  const progress = ChallengeProgressSchema.parse(evaluated.progress);
  const coverage = ChallengeCoverageSchema.parse(evaluated.coverage);
  const evaluatedThroughAt = rows.at(-1)?.gameEndAt ?? run.originalStartAt;
  const completedAt = progressCompleted(progress) ? new Date() : null;
  const applied = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ChallengeRun" WHERE "id" = ${input.runId} FOR UPDATE`;
    const current = await tx.challengeRun.findUniqueOrThrow({
      where: { id: input.runId },
    });
    if (
      current.evaluationRevision !== input.revision ||
      current.runState === "archived"
    ) {
      await tx.challengeRunRevision.update({
        where: {
          runId_revision: { runId: input.runId, revision: input.revision },
        },
        data: {
          revisionState: "stale",
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      return false;
    }
    const snapshot = await tx.challengeRunSnapshot.upsert({
      where: {
        runId_revision: { runId: input.runId, revision: input.revision },
      },
      create: {
        runId: input.runId,
        revision: input.revision,
        progressJson: JSON.stringify(progress),
        coverageJson: JSON.stringify(coverage),
        evaluatedThroughAt,
        completedAt,
      },
      update: {
        progressJson: JSON.stringify(progress),
        coverageJson: JSON.stringify(coverage),
        evaluatedThroughAt,
        completedAt,
      },
    });
    await tx.challengeRun.update({
      where: { id: input.runId },
      data: {
        currentSnapshotId: snapshot.id,
        recomputing: false,
        runState: completedAt === null ? "active" : "completed",
        completedAt,
      },
    });
    await tx.challengeRunRevision.update({
      where: {
        runId_revision: { runId: input.runId, revision: input.revision },
      },
      data: {
        revisionState: "ready",
        completedAt: new Date(),
        errorMessage: null,
      },
    });
    if (completedAt !== null) {
      await tx.challengeActiveRun.deleteMany({ where: { runId: input.runId } });
    }
    const currentRevision = await tx.challengeRunRevision.findUniqueOrThrow({
      where: {
        runId_revision: { runId: input.runId, revision: input.revision },
      },
    });
    const selected = parseProgressionJson(
      currentRevision.selectedAccountsJson,
      ChallengeSelectedAccountsSchema,
    );
    const timelineRequired = challengeNeedsTimeline(contract.matchPredicate);
    await tx.challengeRunCursor.deleteMany({
      where: {
        runId: input.runId,
        puuid: { notIn: selected.map((account) => account.puuid) },
      },
    });
    for (const account of selected) {
      const last = rows.findLast((row) => row.puuid === account.puuid);
      await tx.challengeRunCursor.upsert({
        where: { runId_puuid: { runId: input.runId, puuid: account.puuid } },
        create: {
          runId: input.runId,
          puuid: account.puuid,
          revision: input.revision,
          lastMatchEndAt: last?.gameEndAt ?? null,
          lastMatchId: last?.matchId ?? null,
          timelineRequired,
        },
        update: {
          revision: input.revision,
          lastMatchEndAt: last?.gameEndAt ?? null,
          lastMatchId: last?.matchId ?? null,
          timelineRequired,
        },
      });
    }
    return true;
  });
  if (!applied) return;
  challengeMissingTimelineMatches.inc(coverage.missingTimelineEvidence);
  challengeRecomputeDuration.observe(
    { status: "ready" },
    (Date.now() -
      (
        revisionForMetrics.startedAt ?? revisionForMetrics.createdAt
      ).getTime()) /
      1000,
  );
  if (completedAt !== null) challengeRunCompletions.inc();
}

export async function recomputeChallengeRunPage(
  input: ScoutChallengeRunRecomputeInput,
): Promise<ScoutChallengeRunRecomputePageResult> {
  try {
    const [run, revision] = await Promise.all([
      prisma.challengeRun.findUniqueOrThrow({ where: { id: input.runId } }),
      prisma.challengeRunRevision.findUniqueOrThrow({
        where: {
          runId_revision: { runId: input.runId, revision: input.revision },
        },
      }),
    ]);
    if (
      run.evaluationRevision !== input.revision ||
      run.runState === "archived"
    ) {
      await prisma.challengeRunRevision.update({
        where: { id: revision.id },
        data: { revisionState: "stale", completedAt: new Date() },
      });
      return { complete: true, evaluatedMatches: 0 };
    }
    if (revision.revisionState === "ready") {
      return { complete: true, evaluatedMatches: 0 };
    }
    if (input.cursor === undefined) {
      await prisma.$transaction([
        prisma.challengeRunEvidence.deleteMany({
          where: { runId: input.runId, revision: input.revision },
        }),
        prisma.challengeRunRevision.update({
          where: { id: revision.id },
          data: {
            revisionState: "running",
            startedAt: revision.startedAt ?? new Date(),
            errorMessage: null,
          },
        }),
        prisma.challengeRun.updateMany({
          where: { id: input.runId, evaluationRevision: input.revision },
          data: { runState: "active", recomputing: true },
        }),
      ]);
    }
    const accounts = parseProgressionJson(
      revision.selectedAccountsJson,
      ChallengeSelectedAccountsSchema,
    );
    const page = await fetchChallengeEvidence({
      puuids: accounts.map((account) => account.puuid),
      startAt: run.originalStartAt,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: PAGE_SIZE,
    });
    for (const entry of page.evidence) {
      await prisma.challengeRunEvidence.upsert({
        where: {
          runId_revision_matchId_puuid: {
            runId: input.runId,
            revision: input.revision,
            matchId: MatchIdSchema.parse(entry.match.matchId),
            puuid: LeaguePuuidSchema.parse(entry.puuid),
          },
        },
        create: {
          runId: input.runId,
          revision: input.revision,
          matchId: MatchIdSchema.parse(entry.match.matchId),
          puuid: LeaguePuuidSchema.parse(entry.puuid),
          gameEndAt: new Date(entry.match.gameEndAt),
          timelineComplete: entry.match.timelineEvidenceAvailable,
          evidenceJson: JSON.stringify(entry.match),
        },
        update: {
          gameEndAt: new Date(entry.match.gameEndAt),
          timelineComplete: entry.match.timelineEvidenceAvailable,
          evidenceJson: JSON.stringify(entry.match),
        },
      });
    }
    if (page.rowsRead < PAGE_SIZE) {
      await finalizeRevision(input);
      return {
        complete: true,
        evaluatedMatches: page.evidence.length,
      };
    }
    if (page.nextCursor === undefined) {
      throw new Error(
        "Challenge recomputation page did not advance its cursor",
      );
    }
    return {
      complete: false,
      nextCursor: page.nextCursor,
      evaluatedMatches: page.evidence.length,
    };
  } catch (error) {
    await markRevisionFailure(input, error);
    throw error;
  }
}
