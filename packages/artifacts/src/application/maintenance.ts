import type { MaintenanceCleanupOutput } from "#shared/procedures.ts";
import { transact } from "#infrastructure/database.ts";
import { logEvent, reportError } from "#infrastructure/log.ts";
import { recordEvents } from "./events.ts";
import type { Deps } from "./types.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SESSION_BATCH = 200;
const BOARD_BATCH = 20;
const BLOB_BATCH = 200;
const EVENT_BATCH = 5000;
const ORPHAN_PAGE = 500;

export const SYSTEM_ACTOR = {
  key: "runner:artifacts-maintenance",
  kind: "runner",
  name: "artifacts maintenance",
} as const;
export const CLEANUP_EVENT = "maintenance.cleanup";

export function createMaintenance(deps: Deps) {
  const { db } = deps;
  /** Where the next orphan sweep resumes; null starts over. */
  let orphanCursor: string | null = null;

  async function systemActorId() {
    const actor = await db.actor.upsert({
      where: { key: SYSTEM_ACTOR.key },
      create: { ...SYSTEM_ACTOR, metadata: {} },
      update: { lastSeenAt: deps.now() },
    });
    return actor.id;
  }

  async function expireSessions(): Promise<{ count: number; more: boolean }> {
    const expired = await db.uploadSession.findMany({
      where: { committedVersionId: null, expiresAt: { lte: deps.now() } },
      select: { id: true },
      take: SESSION_BATCH,
    });
    const result = await db.uploadSession.deleteMany({
      where: { id: { in: expired.map((session) => session.id) } },
    });
    return { count: result.count, more: expired.length === SESSION_BATCH };
  }

  /**
   * Drops a board's content: the manifest rows of every version and the
   * upload records that name the same blobs. Threads, comments, versions and
   * the index stay, so feedback history survives. Blobs go later.
   */
  async function purgeBoard(
    boardId: string,
    actorId: string,
  ): Promise<boolean> {
    const purged = await transact(db, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR UPDATE`;
      const board = await tx.board.findUnique({ where: { id: boardId } });
      if (board === null || board.keep || board.expiredAt !== null) return null;
      const versions = await tx.version.findMany({
        where: { artifact: { boardId } },
        select: { id: true },
      });
      const ids = versions.map((version) => version.id);
      await tx.versionFile.deleteMany({ where: { versionId: { in: ids } } });
      await tx.uploadFile.deleteMany({
        where: { upload: { boardId, committedVersionId: { not: null } } },
      });
      await tx.version.updateMany({
        where: { id: { in: ids }, purgedAt: null },
        data: { purgedAt: deps.now() },
      });
      await tx.board.update({
        where: { id: boardId },
        data: { expiredAt: deps.now() },
      });
      await recordEvents(tx, [
        {
          boardId,
          kind: "board.purged",
          entityId: boardId,
          actorId,
          requestId: "maintenance",
        },
      ]);
      return ids;
    });
    if (purged === null) return false;
    for (const id of purged) deps.tokens.invalidateVersion(id);
    return true;
  }

  async function purgeBoards(
    actorId: string,
  ): Promise<{ count: number; more: boolean }> {
    const now = deps.now().getTime();
    const [idleDays, graceDays] = await Promise.all([
      deps.settings.value("boardIdleDays"),
      deps.settings.value("archiveGraceDays"),
    ]);
    const due = await db.board.findMany({
      where: {
        keep: false,
        expiredAt: null,
        OR: [
          {
            archivedAt: { not: null, lte: new Date(now - graceDays * DAY_MS) },
          },
          { lastActivityAt: { lte: new Date(now - idleDays * DAY_MS) } },
        ],
      },
      select: { id: true },
      take: BOARD_BATCH,
    });
    let count = 0;
    for (const board of due)
      if (await purgeBoard(board.id, actorId)) count += 1;
    return { count, more: due.length === BOARD_BATCH };
  }

  /** Locks the blob row, re-checks references, deletes the row, then the object. */
  async function deleteBlob(sha256: string): Promise<boolean> {
    const storageKey = await transact(db, async (tx) => {
      const rows = await tx.$queryRaw<{ storageKey: string }[]>`
        SELECT "storageKey" FROM "Blob" WHERE "sha256" = ${sha256} FOR UPDATE`;
      const blob = rows[0];
      if (blob === undefined) return null;
      const referenced = await tx.$queryRaw<{ n: number }[]>`
        SELECT (
          (SELECT COUNT(*) FROM "VersionFile" WHERE "sha256" = ${sha256}) +
          (SELECT COUNT(*) FROM "UploadFile" WHERE "sha256" = ${sha256}) +
          (SELECT COUNT(*) FROM "Version" WHERE "posterSha256" = ${sha256})
        )::int AS "n"`;
      if ((referenced[0]?.n ?? 0) > 0) return null;
      await tx.blob.delete({ where: { sha256 } });
      return blob.storageKey;
    });
    if (storageKey === null) return false;
    await deps.store.delete(storageKey);
    return true;
  }

  async function deleteBlobs(): Promise<{ count: number; more: boolean }> {
    const grace = await deps.settings.value("blobGraceHours");
    const cutoff = new Date(deps.now().getTime() - grace * HOUR_MS);
    const unreferenced = await db.$queryRaw<{ sha256: string }[]>`
      SELECT b."sha256" FROM "Blob" b
      WHERE b."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "VersionFile" f WHERE f."sha256" = b."sha256")
        AND NOT EXISTS (SELECT 1 FROM "UploadFile" u WHERE u."sha256" = b."sha256")
        AND NOT EXISTS (SELECT 1 FROM "Version" v WHERE v."posterSha256" = b."sha256")
      ORDER BY b."createdAt"
      LIMIT ${BLOB_BATCH}`;
    let count = 0;
    for (const row of unreferenced) {
      try {
        if (await deleteBlob(row.sha256)) count += 1;
      } catch (error) {
        reportError(error, "artifacts_blob_delete_failed");
      }
    }
    return { count, more: unreferenced.length === BLOB_BATCH };
  }

  /**
   * Deletes objects no `Blob` row names: an upload that died mid-body leaves
   * one. Only objects older than the blob grace are touched, so a body still
   * being written is never swept. Pages through `objects/` across runs.
   */
  async function sweepOrphans(): Promise<{ count: number; more: boolean }> {
    const grace = await deps.settings.value("blobGraceHours");
    const cutoff = new Date(deps.now().getTime() - grace * HOUR_MS);
    const page = await deps.store.list("objects/", orphanCursor, ORPHAN_PAGE);
    const old = page.objects.filter((entry) => entry.lastModified < cutoff);
    const known = await db.blob.findMany({
      where: { storageKey: { in: old.map((entry) => entry.key) } },
      select: { storageKey: true },
    });
    const referenced = new Set(known.map((blob) => blob.storageKey));
    let count = 0;
    for (const entry of old) {
      if (referenced.has(entry.key)) continue;
      try {
        await deps.store.delete(entry.key);
        count += 1;
      } catch (error) {
        reportError(error, "artifacts_orphan_object_delete_failed");
      }
    }
    orphanCursor = page.truncated ? (page.objects.at(-1)?.key ?? null) : null;
    return { count, more: page.truncated };
  }

  async function pruneEvents(): Promise<{ count: number; more: boolean }> {
    const days = await deps.settings.value("eventRetentionDays");
    const cutoff = new Date(deps.now().getTime() - days * DAY_MS);
    const count = await db.$executeRaw`
      DELETE FROM "Event" WHERE "seq" IN (
        SELECT "seq" FROM "Event" WHERE "occurredAt" < ${cutoff} LIMIT ${EVENT_BATCH})`;
    return { count, more: count === EVENT_BATCH };
  }

  return {
    /** One bounded pass; the hourly schedule calls it until `more` is false. */
    async cleanup(): Promise<MaintenanceCleanupOutput> {
      if (!(await deps.settings.value("artifactsEnabled")))
        return {
          status: "paused",
          expiredSessions: 0,
          purgedBoards: 0,
          deletedBlobs: 0,
          prunedEvents: 0,
          more: false,
        };
      const actorId = await systemActorId();
      const sessions = await expireSessions();
      const boards = await purgeBoards(actorId);
      const blobs = await deleteBlobs();
      const orphans = await sweepOrphans();
      const events = await pruneEvents();
      const result: MaintenanceCleanupOutput = {
        status: "ok",
        expiredSessions: sessions.count,
        purgedBoards: boards.count,
        deletedBlobs: blobs.count + orphans.count,
        prunedEvents: events.count,
        more:
          sessions.more ||
          boards.more ||
          blobs.more ||
          orphans.more ||
          events.more,
      };
      // The scrape reads this row, so the gauge survives a restart.
      await db.event.create({
        data: {
          boardId: null,
          kind: CLEANUP_EVENT,
          entityId: "cleanup",
          actorId,
          requestId: "maintenance",
          payload: result,
        },
      });
      logEvent("artifacts_cleanup", {
        expiredSessions: result.expiredSessions,
        purgedBoards: result.purgedBoards,
        deletedBlobs: result.deletedBlobs,
        prunedEvents: result.prunedEvents,
        more: result.more,
      });
      return result;
    },

    /** Gauges for `/metrics`: backlog of feedback and the last good cleanup. */
    async gauges() {
      const settle = await deps.settings.value("feedbackSettleSeconds");
      const [undelivered, oldest, cleanup] = await Promise.all([
        db.$queryRaw<{ n: number }[]>`
          SELECT COUNT(*)::int AS "n" FROM "Comment" c
          JOIN "Thread" t ON t."id" = c."threadId" AND t."state" = 'open'
          JOIN "Actor" a ON a."id" = c."authorId" AND a."kind" = 'human'
          LEFT JOIN "Delivery" d ON d."commentId" = c."id"
          WHERE d."commentId" IS NULL
            AND c."updatedAt" <= ${new Date(deps.now().getTime() - settle * 1000)}`,
        db.$queryRaw<{ seconds: number | null }[]>`
          SELECT EXTRACT(EPOCH FROM (${deps.now()} - MIN(c."createdAt")))::float AS "seconds"
          FROM "Comment" c
          JOIN "Thread" t ON t."id" = c."threadId" AND t."state" = 'open'
          JOIN "Actor" a ON a."id" = c."authorId" AND a."kind" = 'human'
          LEFT JOIN "Delivery" d ON d."commentId" = c."id"
          WHERE d."commentId" IS NULL OR d."handledAt" IS NULL`,
        db.event.findFirst({
          where: { kind: CLEANUP_EVENT },
          orderBy: { seq: "desc" },
          select: { occurredAt: true },
        }),
      ]);
      return {
        undeliveredComments: undelivered[0]?.n ?? 0,
        oldestUnhandledSeconds: oldest[0]?.seconds ?? 0,
        cleanupLastSuccessSeconds:
          cleanup === null
            ? 0
            : Math.floor(cleanup.occurredAt.getTime() / 1000),
      };
    },
  };
}
