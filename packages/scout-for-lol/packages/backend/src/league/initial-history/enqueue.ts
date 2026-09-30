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

/**
 * The namespace half of the initial-history advisory lock key.
 *
 * Named once and shared by the lock and by
 * {@link initialMatchHistoryImportLockWaiters}, so a predicate about the lock
 * can never come to describe a different lock than the one taken. A literal
 * repeated in both places would drift silently, and a predicate that drifted
 * would answer about a lock nobody holds.
 */
const INITIAL_HISTORY_LOCK_NAMESPACE = "scout-initial-history";

export async function lockInitialMatchHistoryImport(
  db: Pick<Db, "$executeRaw">,
  puuid: LeaguePuuid,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INITIAL_HISTORY_LOCK_NAMESPACE}), hashtext(${puuid}))`;
}

const LockWaiterRowsSchema = z
  .array(z.object({ waiters: z.coerce.bigint() }))
  .length(1);

/**
 * How many sessions are BLOCKED waiting for this puuid's initial-history lock.
 *
 * Every clause narrows the question to the one fact a caller wants to assert,
 * because `pg_locks` is cluster-wide and the tests of this repository share a
 * single Postgres server. An unqualified "is any advisory lock contended"
 * counts waiters belonging to other suites, to other worktrees running their
 * own suites against the same server, and to any `psql` session that happens
 * to be waiting — so it reports "the worker is blocked" while the worker has
 * not even started, and the caller proceeds into a race it meant to wait out.
 *
 * `database` excludes every other test database on the server; `objsubid = 2`
 * selects the two-key form this lock uses; `classid` and `objid` pin the exact
 * key. The keys are masked into unsigned 32 bits because `hashtext` returns a
 * signed integer while `pg_locks` exposes the same bits as an OID: the raw
 * values compare unequal whenever the hash is negative.
 */
export async function initialMatchHistoryImportLockWaiters(
  db: Pick<Db, "$queryRaw">,
  puuid: LeaguePuuid,
): Promise<number> {
  const rows = LockWaiterRowsSchema.parse(
    await db.$queryRaw`
      SELECT count(*)::bigint AS waiters
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND NOT granted
        AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
        AND objsubid = 2
        AND classid::bigint
          = (hashtext(${INITIAL_HISTORY_LOCK_NAMESPACE})::bigint & 4294967295)
        AND objid::bigint = (hashtext(${puuid})::bigint & 4294967295)
    `,
  );
  const waiters = rows[0]?.waiters;
  if (waiters === undefined) {
    throw new Error("pg_locks did not return an initial-history waiter count");
  }
  return Number(waiters);
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
