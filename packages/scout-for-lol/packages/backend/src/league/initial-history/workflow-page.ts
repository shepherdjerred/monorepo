import { LeaguePuuidSchema } from "@scout-for-lol/data";
import type {
  InitialHistoryPageResult,
  ScoutInitialHistoryInput,
} from "@scout-for-lol/temporal";
import type { InitialMatchHistoryImport } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { PermanentImportError } from "#src/league/initial-history/errors.ts";
import {
  claimTrackedJobOrCompleteUntracked,
  persistFailure,
  processRiotPhases,
  refreshQueueMetrics,
} from "#src/league/initial-history/worker.ts";
import { createLogger } from "#src/logger.ts";
import { initialHistoryImportPhasesTotal } from "#src/metrics/initial-history-import.ts";

const logger = createLogger("initial-history-workflow-page");

function workflowCursor(job: InitialMatchHistoryImport): string {
  return `${job.requestedAt.toISOString()}:${job.phase}:${job.nextMatchIndex.toString()}`;
}

export async function processInitialHistoryWorkflowPage(
  input: ScoutInitialHistoryInput,
  db: ExtendedPrismaClient = prisma,
  now = new Date(),
): Promise<InitialHistoryPageResult> {
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const selected = await db.initialMatchHistoryImport.findUnique({
    where: { puuid },
  });
  if (selected === null) {
    throw new PermanentImportError(
      "contract",
      `Initial history import ${puuid} does not exist`,
    );
  }
  if (selected.phase === "complete") {
    return { persistedMatches: 0, complete: true, nextAction: "continue" };
  }
  if (selected.phase === "failed") {
    const code =
      selected.errorCode === "authentication" ? "authentication" : "contract";
    throw new PermanentImportError(
      code,
      `Initial history import ${puuid} is permanently failed`,
    );
  }
  if (selected.phase === "publish") {
    if (input.cursor !== "lake-folded") {
      return {
        nextCursor: "lake-folded",
        persistedMatches: 0,
        complete: false,
        nextAction: "fold-lake",
      };
    }
    await db.initialMatchHistoryImport.updateMany({
      where: { puuid, phase: "publish", requestedAt: selected.requestedAt },
      data: {
        phase: "complete",
        errorCode: null,
        completedAt: now,
        lastAttemptAt: now,
      },
    });
    initialHistoryImportPhasesTotal.inc({
      phase: "publish",
      outcome: "complete",
    });
    await refreshQueueMetrics(db);
    return { persistedMatches: 0, complete: true, nextAction: "continue" };
  }

  const shouldProcess = await claimTrackedJobOrCompleteUntracked(
    db,
    selected,
    now,
  );
  if (!shouldProcess) {
    await refreshQueueMetrics(db);
    return { persistedMatches: 0, complete: true, nextAction: "continue" };
  }
  try {
    await processRiotPhases(db, selected, now, 1);
  } catch (error) {
    logger.error("Initial match history workflow activity failed", error);
    const latest = await db.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid },
    });
    await persistFailure(db, latest, error, now);
    throw error;
  }
  const latest = await db.initialMatchHistoryImport.findUniqueOrThrow({
    where: { puuid },
  });
  await refreshQueueMetrics(db);
  return {
    nextCursor:
      latest.phase === "publish" ? "lake-folded" : workflowCursor(latest),
    persistedMatches: Math.max(
      0,
      latest.nextMatchIndex - selected.nextMatchIndex,
    ),
    complete: latest.phase === "complete",
    nextAction: latest.phase === "publish" ? "fold-lake" : "continue",
  };
}
