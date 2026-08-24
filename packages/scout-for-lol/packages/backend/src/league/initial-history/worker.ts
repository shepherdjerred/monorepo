import { z, ZodError } from "zod";
import * as Sentry from "@sentry/bun";
import {
  MatchIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
  type LeaguePuuid,
  type MatchId,
  type Rank,
} from "@scout-for-lol/data";
import type { InitialMatchHistoryImport } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import {
  ImportStorageError,
  LakeStagingError,
  PermanentImportError,
} from "#src/league/initial-history/errors.ts";
import {
  fetchCurrentRanks,
  fetchInitialMatch,
  fetchInitialMatchIds,
  INITIAL_HISTORY_MATCH_COUNT,
} from "#src/league/initial-history/riot.ts";
import { lockInitialMatchHistoryImport } from "#src/league/initial-history/enqueue.ts";
import { publishReadyImports } from "#src/league/initial-history/publish.ts";
import { createLogger } from "#src/logger.ts";
import {
  initialHistoryImportJobs,
  initialHistoryImportMatchesTotal,
  initialHistoryImportOldestActionableTimestamp,
  initialHistoryImportPhasesTotal,
  initialHistoryImportRankTotal,
  initialHistoryImportRetriesTotal,
} from "#src/metrics/initial-history-import.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";

const logger = createLogger("initial-history-import");
const RIOT_CALLS_PER_TICK = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];
const ACTIONABLE_PHASES = ["queued", "matches", "rank", "publish"];
const ALL_PHASES = [...ACTIONABLE_PHASES, "complete", "failed"];
let riotBudgetMinute: number | undefined;
let riotCallsThisMinute = 0;
let workerInProgress = false;

const MatchSnapshotSchema = z
  .array(MatchIdSchema)
  .max(INITIAL_HISTORY_MATCH_COUNT);

type RetryReason =
  "rate_limit" | "upstream" | "transport" | "storage" | "staging";

function serializeRank(rank: Rank | undefined): string | null {
  return rank === undefined ? null : JSON.stringify(rank);
}

function classifyFailure(
  error: unknown,
):
  | { kind: "permanent"; code: "authentication" | "contract" }
  | { kind: "retry"; reason: RetryReason } {
  if (error instanceof PermanentImportError) {
    return { kind: "permanent", code: error.code };
  }
  if (error instanceof ZodError) {
    return { kind: "permanent", code: "contract" };
  }
  if (error instanceof LakeStagingError) {
    return { kind: "retry", reason: "staging" };
  }
  if (error instanceof ImportStorageError) {
    return { kind: "retry", reason: "storage" };
  }
  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) {
    return { kind: "permanent", code: "authentication" };
  }
  if (status !== 429 && status !== undefined && status >= 400 && status < 500) {
    return { kind: "permanent", code: "contract" };
  }
  if (status === 429) return { kind: "retry", reason: "rate_limit" };
  if (status !== undefined) return { kind: "retry", reason: "upstream" };
  return { kind: "retry", reason: "transport" };
}

async function trackedAliases(
  db: ExtendedPrismaClient,
  puuid: LeaguePuuid,
): Promise<string[]> {
  const accounts = await db.account.findMany({
    where: { puuid },
    include: { player: { select: { alias: true } } },
  });
  return [...new Set(accounts.map((account) => account.player.alias))];
}

async function claimTrackedJobOrCompleteUntracked(
  db: ExtendedPrismaClient,
  selected: InitialMatchHistoryImport,
  now: Date,
): Promise<boolean> {
  const puuid = LeaguePuuidSchema.parse(selected.puuid);
  return await db.$transaction(async (tx) => {
    await lockInitialMatchHistoryImport(tx, puuid);
    const current = await tx.initialMatchHistoryImport.findUnique({
      where: { puuid },
      select: { phase: true, updatedAt: true },
    });
    if (
      current?.phase !== selected.phase ||
      current.updatedAt.getTime() !== selected.updatedAt.getTime()
    ) {
      return false;
    }

    const tracked = await tx.account.count({ where: { puuid } });
    if (tracked > 0) return true;

    await tx.initialMatchHistoryImport.updateMany({
      where: {
        puuid,
        phase: selected.phase,
        updatedAt: selected.updatedAt,
      },
      data: {
        phase: "complete",
        completedAt: now,
        errorCode: "untracked",
        lastAttemptAt: now,
      },
    });
    return false;
  });
}

async function handOffLiveCursor(
  db: ExtendedPrismaClient,
  job: InitialMatchHistoryImport,
  now: Date,
): Promise<InitialMatchHistoryImport> {
  return await db.$transaction(async (tx) => {
    await tx.account.updateMany({
      where: { puuid: job.puuid },
      data: {
        lastProcessedMatchId:
          job.newestMatchId === null
            ? null
            : MatchIdSchema.parse(job.newestMatchId),
        lastMatchTime: job.newestMatchTime,
        lastCheckedAt: now,
        updatedTime: now,
      },
    });
    return await tx.initialMatchHistoryImport.update({
      where: { puuid: job.puuid },
      data: {
        phase: "rank",
        cursorHandedOffAt: now,
        attemptCount: 0,
        errorCode: null,
        lastAttemptAt: now,
        nextAttemptAt: now,
      },
    });
  });
}

async function ingestOneMatch(
  db: ExtendedPrismaClient,
  job: InitialMatchHistoryImport,
  matchIds: MatchId[],
  now: Date,
): Promise<InitialMatchHistoryImport> {
  const matchId = MatchIdSchema.parse(matchIds[job.nextMatchIndex]);
  const region = RegionSchema.parse(job.region);
  const match = await fetchInitialMatch({ matchId, region });
  if (match === null) {
    initialHistoryImportMatchesTotal.inc({ outcome: "skipped" });
    return await db.initialMatchHistoryImport.update({
      where: { puuid: job.puuid },
      data: {
        nextMatchIndex: { increment: 1 },
        attemptCount: 0,
        errorCode: null,
        lastAttemptAt: now,
        nextAttemptAt: now,
      },
    });
  }

  let ingestResult: { staged: boolean; stored: boolean };
  try {
    ingestResult = await recordMatchForReportStore({
      match,
      source: "initial_history_import",
      trackedPlayerAliases: await trackedAliases(
        db,
        LeaguePuuidSchema.parse(job.puuid),
      ),
    });
  } catch (error) {
    throw new ImportStorageError(matchId, error);
  }
  if (!ingestResult.stored) {
    throw new ImportStorageError(
      matchId,
      new Error("Canonical S3 storage is unavailable"),
    );
  }
  if (!ingestResult.staged) throw new LakeStagingError(matchId);

  initialHistoryImportMatchesTotal.inc({ outcome: "stored" });
  return await db.initialMatchHistoryImport.update({
    where: { puuid: job.puuid },
    data: {
      nextMatchIndex: { increment: 1 },
      newestMatchTime: job.newestMatchTime ?? new Date(match.info.gameCreation),
      attemptCount: 0,
      errorCode: null,
      lastAttemptAt: now,
      nextAttemptAt: now,
    },
  });
}

async function processRiotPhases(
  db: ExtendedPrismaClient,
  selected: InitialMatchHistoryImport,
  now: Date,
  availableCalls: number,
): Promise<void> {
  let job = selected;
  let calls = 0;
  const countCall = (): void => {
    calls += 1;
    riotCallsThisMinute += 1;
  };
  while (calls < availableCalls) {
    if (job.phase === "queued") {
      let matchIds: MatchId[];
      try {
        matchIds = await fetchInitialMatchIds({
          puuid: job.puuid,
          region: RegionSchema.parse(job.region),
        });
      } finally {
        countCall();
      }
      job = await db.initialMatchHistoryImport.update({
        where: { puuid: job.puuid },
        data: {
          phase: "matches",
          matchIdsJson: JSON.stringify(matchIds),
          snapshotAt: now,
          newestMatchId: matchIds[0] ?? null,
          nextMatchIndex: 0,
          attemptCount: 0,
          errorCode: null,
          lastAttemptAt: now,
          nextAttemptAt: now,
        },
      });
      initialHistoryImportPhasesTotal.inc({
        phase: "queued",
        outcome: "complete",
      });
      continue;
    }

    if (job.phase === "matches") {
      const matchIds = MatchSnapshotSchema.parse(
        JSON.parse(job.matchIdsJson ?? "null"),
      );
      if (job.nextMatchIndex >= matchIds.length) {
        job = await handOffLiveCursor(db, job, now);
        initialHistoryImportPhasesTotal.inc({
          phase: "matches",
          outcome: "complete",
        });
        continue;
      }
      try {
        job = await ingestOneMatch(db, job, matchIds, now);
      } finally {
        countCall();
      }
      continue;
    }

    if (job.phase === "rank") {
      let ranks: Awaited<ReturnType<typeof fetchCurrentRanks>>;
      try {
        ranks = await fetchCurrentRanks({
          puuid: job.puuid,
          region: RegionSchema.parse(job.region),
        });
      } finally {
        countCall();
      }
      await db.currentRankSnapshot.upsert({
        where: { puuid: job.puuid },
        create: {
          puuid: job.puuid,
          soloRank: serializeRank(ranks.solo),
          flexRank: serializeRank(ranks.flex),
          fetchedAt: now,
        },
        update: {
          soloRank: serializeRank(ranks.solo),
          flexRank: serializeRank(ranks.flex),
          fetchedAt: now,
        },
      });
      await db.initialMatchHistoryImport.update({
        where: { puuid: job.puuid },
        data: {
          phase: "publish",
          lastImportedAt: now,
          attemptCount: 0,
          errorCode: null,
          lastAttemptAt: now,
          nextAttemptAt: now,
        },
      });
      initialHistoryImportRankTotal.inc({ outcome: "stored" });
      initialHistoryImportPhasesTotal.inc({
        phase: "rank",
        outcome: "complete",
      });
    }
    return;
  }
}

async function persistFailure(
  db: ExtendedPrismaClient,
  job: InitialMatchHistoryImport,
  error: unknown,
  now: Date,
): Promise<void> {
  const failure = classifyFailure(error);
  if (failure.kind === "permanent") {
    await db.initialMatchHistoryImport.update({
      where: { puuid: job.puuid },
      data: {
        phase: "failed",
        errorCode: failure.code,
        completedAt: now,
        lastAttemptAt: now,
      },
    });
    initialHistoryImportPhasesTotal.inc({
      phase: job.phase,
      outcome: "failed",
    });
    if (job.phase === "rank") {
      initialHistoryImportRankTotal.inc({ outcome: "failed" });
    }
    Sentry.captureException(error, {
      tags: { source: "initial-history-import", errorCode: failure.code },
    });
    return;
  }

  const attemptCount = job.attemptCount + 1;
  const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, 3)];
  if (delay === undefined) throw new Error("Import retry schedule is empty");
  await db.initialMatchHistoryImport.update({
    where: { puuid: job.puuid },
    data: {
      attemptCount,
      errorCode: failure.reason,
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.getTime() + delay),
    },
  });
  initialHistoryImportRetriesTotal.inc({ reason: failure.reason });
  initialHistoryImportPhasesTotal.inc({
    phase: job.phase,
    outcome: "retry",
  });
  if (job.phase === "rank") {
    initialHistoryImportRankTotal.inc({ outcome: "retry" });
  }
}

async function refreshQueueMetrics(db: ExtendedPrismaClient): Promise<void> {
  const [counts, oldest] = await Promise.all([
    db.initialMatchHistoryImport.groupBy({
      by: ["phase"],
      _count: { _all: true },
    }),
    db.initialMatchHistoryImport.findFirst({
      where: { phase: { in: ACTIONABLE_PHASES } },
      orderBy: { requestedAt: "asc" },
      select: { requestedAt: true },
    }),
  ]);
  const countByPhase = new Map(
    counts.map((entry) => [entry.phase, entry._count._all]),
  );
  for (const phase of ALL_PHASES) {
    initialHistoryImportJobs.set({ phase }, countByPhase.get(phase) ?? 0);
  }
  initialHistoryImportOldestActionableTimestamp.set(
    oldest?.requestedAt.getTime() === undefined
      ? 0
      : oldest.requestedAt.getTime() / 1000,
  );
}

export async function runInitialHistoryImportTick(
  db: ExtendedPrismaClient = prisma,
  now = new Date(),
): Promise<void> {
  if (workerInProgress) return;
  workerInProgress = true;
  try {
    const minute = Math.floor(now.getTime() / 60_000);
    if (riotBudgetMinute !== minute) {
      riotBudgetMinute = minute;
      riotCallsThisMinute = 0;
    }
    const availableCalls = Math.max(
      0,
      RIOT_CALLS_PER_TICK - riotCallsThisMinute,
    );
    const selected = await db.initialMatchHistoryImport.findFirst({
      where: {
        phase: { in: ACTIONABLE_PHASES },
        nextAttemptAt: { lte: now },
      },
      orderBy: [
        { lastAttemptAt: { sort: "asc", nulls: "first" } },
        { requestedAt: "asc" },
      ],
    });

    if (selected !== null) {
      const shouldProcess = await claimTrackedJobOrCompleteUntracked(
        db,
        selected,
        now,
      );
      if (shouldProcess && selected.phase !== "publish" && availableCalls > 0) {
        try {
          await processRiotPhases(db, selected, now, availableCalls);
        } catch (error) {
          logger.error("Initial match history import attempt failed", error);
          const latest = await db.initialMatchHistoryImport.findUniqueOrThrow({
            where: { puuid: selected.puuid },
          });
          await persistFailure(db, latest, error, now);
        }
      }
    }

    try {
      await publishReadyImports(db, now);
    } catch (error) {
      logger.error("Initial history report-lake publish failed", error);
      const publishing = await db.initialMatchHistoryImport.findFirst({
        where: { phase: "publish", nextAttemptAt: { lte: now } },
        orderBy: { requestedAt: "asc" },
      });
      if (publishing !== null) {
        await persistFailure(
          db,
          publishing,
          new LakeStagingError("report-lake fold", error),
          now,
        );
      }
    }
    await refreshQueueMetrics(db);
  } finally {
    workerInProgress = false;
  }
}

export function resetInitialHistoryWorkerStateForTests(): void {
  riotBudgetMinute = undefined;
  riotCallsThisMinute = 0;
  workerInProgress = false;
}
