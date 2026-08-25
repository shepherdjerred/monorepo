import {
  MatchIdSchema,
  type LeaguePuuid,
  type Region,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { InitialMatchHistoryImport } from "#generated/prisma/client/index.js";
import type { Db } from "#src/database/index.ts";

export const INITIAL_HISTORY_REFETCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const StoredMatchIdsSchema = z.array(MatchIdSchema).max(20);

export async function lockInitialMatchHistoryImport(
  db: Pick<Db, "$executeRaw">,
  puuid: LeaguePuuid,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-initial-history'), hashtext(${puuid}))`;
}

async function installSharedCursor(input: {
  db: Db;
  puuid: LeaguePuuid;
  newestMatchId: string | null;
  newestMatchTime: Date | null;
  handedOffAt: Date;
  requestedAt: Date;
}): Promise<void> {
  const latestAccount = await input.db.account.findFirst({
    where: { puuid: input.puuid, lastProcessedMatchId: { not: null } },
    orderBy: { lastCheckedAt: { sort: "desc", nulls: "last" } },
    select: {
      lastProcessedMatchId: true,
      lastMatchTime: true,
      lastCheckedAt: true,
    },
  });
  const cursor =
    latestAccount?.lastProcessedMatchId ??
    (input.newestMatchId === null
      ? null
      : MatchIdSchema.parse(input.newestMatchId));
  await input.db.account.updateMany({
    where: { puuid: input.puuid, lastProcessedMatchId: null },
    data: {
      lastProcessedMatchId: cursor,
      lastMatchTime: latestAccount?.lastMatchTime ?? input.newestMatchTime,
      lastCheckedAt: latestAccount?.lastCheckedAt ?? input.handedOffAt,
      updatedTime: input.requestedAt,
    },
  });
}

async function installSharedCursorIfHandedOff(input: {
  db: Db;
  puuid: LeaguePuuid;
  job: InitialMatchHistoryImport;
  requestedAt: Date;
}): Promise<void> {
  if (input.job.cursorHandedOffAt === null) return;
  await installSharedCursor({
    db: input.db,
    puuid: input.puuid,
    newestMatchId: input.job.newestMatchId,
    newestMatchTime: input.job.newestMatchTime,
    handedOffAt: input.job.cursorHandedOffAt,
    requestedAt: input.requestedAt,
  });
}

export async function enqueueInitialMatchHistoryImport(input: {
  puuid: LeaguePuuid;
  region: Region;
  db: Db;
  requestedAt?: Date;
}): Promise<void> {
  const requestedAt = input.requestedAt ?? new Date();

  await lockInitialMatchHistoryImport(input.db, input.puuid);

  const existing = await input.db.initialMatchHistoryImport.findUnique({
    where: { puuid: input.puuid },
  });
  if (existing === null) {
    await input.db.initialMatchHistoryImport.create({
      data: {
        puuid: input.puuid,
        region: input.region,
        phase: "queued",
        nextAttemptAt: requestedAt,
        requestedAt,
      },
    });
    return;
  }

  if (["queued", "matches", "rank", "publish"].includes(existing.phase)) {
    await installSharedCursorIfHandedOff({
      db: input.db,
      puuid: input.puuid,
      job: existing,
      requestedAt,
    });
    await input.db.initialMatchHistoryImport.update({
      where: { puuid: input.puuid },
      data: { requestedAt },
    });
    return;
  }

  if (existing.phase === "failed") {
    const resumedPhase =
      existing.cursorHandedOffAt === null
        ? existing.matchIdsJson === null
          ? "queued"
          : "matches"
        : "rank";
    await installSharedCursorIfHandedOff({
      db: input.db,
      puuid: input.puuid,
      job: existing,
      requestedAt,
    });
    await input.db.initialMatchHistoryImport.update({
      where: { puuid: input.puuid },
      data: {
        region: input.region,
        phase: resumedPhase,
        requestedAt,
        nextAttemptAt: requestedAt,
        completedAt: null,
        attemptCount: 0,
        errorCode: null,
      },
    });
    return;
  }

  const lastFetchAt = existing.lastImportedAt ?? existing.snapshotAt;
  const importedRecently =
    lastFetchAt !== null &&
    requestedAt.getTime() - lastFetchAt.getTime() <
      INITIAL_HISTORY_REFETCH_COOLDOWN_MS;
  if (importedRecently && existing.phase === "complete") {
    let resumedPhase = "publish";
    if (existing.lastImportedAt === null) {
      StoredMatchIdsSchema.parse(JSON.parse(existing.matchIdsJson ?? "null"));
      resumedPhase = existing.cursorHandedOffAt === null ? "matches" : "rank";
    }
    await installSharedCursorIfHandedOff({
      db: input.db,
      puuid: input.puuid,
      job: existing,
      requestedAt,
    });
    await input.db.initialMatchHistoryImport.update({
      where: { puuid: input.puuid },
      data: {
        phase: resumedPhase,
        requestedAt,
        nextAttemptAt: requestedAt,
        completedAt: null,
        attemptCount: 0,
        errorCode: null,
      },
    });
    return;
  }

  await input.db.initialMatchHistoryImport.update({
    where: { puuid: input.puuid },
    data: {
      region: input.region,
      phase: "queued",
      matchIdsJson: null,
      snapshotAt: null,
      nextMatchIndex: 0,
      newestMatchId: null,
      newestMatchTime: null,
      cursorHandedOffAt: null,
      attemptCount: 0,
      nextAttemptAt: requestedAt,
      errorCode: null,
      requestedAt,
      completedAt: null,
      lastImportedAt: null,
    },
  });
}
