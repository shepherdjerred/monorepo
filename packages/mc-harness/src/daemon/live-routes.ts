/**
 * Live minecraft-tsmc routes: `/live/*` and the guard every write to
 * `/targets/live/*` passes through.
 */
import {
  LiveBackupRequestSchema,
  LiveBackupResponseSchema,
  LiveJournalResponseSchema,
  LiveStatusResponseSchema,
  LiveUndoRequestSchema,
  LiveUndoResponseSchema,
  readLiveWriteFlags,
} from "#protocol/live.ts";
import { LiveGuardRefusal, type LiveWriteOp } from "#src/live/guard.ts";
import { LiveError, type LiveService } from "#src/live/service.ts";
import type { Target } from "#src/target.ts";
import { body, DaemonError, reply } from "./http.ts";

type Log = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * Runs a write on its target. Sandbox writes run directly; live writes go
 * through the guard (reason, players, backups, snapshot, journal).
 */
export async function guarded<T>(
  call: { target: Target; request: Request; ctx: { live: LiveService } },
  op: () => Promise<LiveWriteOp>,
  run: (target: Target) => Promise<T>,
): Promise<T> {
  return call.target.kind === "live"
    ? call.ctx.live.write(
        await op(),
        readLiveWriteFlags(call.request.headers),
        run,
      )
    : run(call.target);
}

/** The box a snapshot covers, so restoring it is guarded like a write. */
export async function snapshotBox(target: Target, snapshotId: string) {
  const { snapshots } = await target.bridge.snapshotList();
  const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
  if (snapshot === undefined) {
    throw new DaemonError(`No snapshot ${snapshotId} on ${target.id}`, 404);
  }
  return snapshot.box;
}

export async function dispatchLive(
  ctx: { live: LiveService; log: Log },
  url: URL,
  request: Request,
  action: string,
): Promise<Response> {
  if (action === "status" && request.method === "GET") {
    return reply(LiveStatusResponseSchema, await ctx.live.describe());
  }
  if (action === "backup" && request.method === "POST") {
    const { reason, wait } = await body(request, LiveBackupRequestSchema);
    ctx.log("live backup", { wait });
    return reply(LiveBackupResponseSchema, await ctx.live.backup(reason, wait));
  }
  if (action === "journal" && request.method === "GET") {
    const since = url.searchParams.get("since");
    const sinceDate = since === null ? undefined : new Date(since);
    if (sinceDate !== undefined && Number.isNaN(sinceDate.getTime())) {
      throw new DaemonError(
        `since must be an ISO timestamp, got ${since ?? ""}`,
      );
    }
    return reply(LiveJournalResponseSchema, {
      entries: await ctx.live.journalEntries(sinceDate),
    });
  }
  if (action === "undo" && request.method === "POST") {
    const undo = await body(request, LiveUndoRequestSchema);
    ctx.log("live undo", { id: undo.id });
    return reply(
      LiveUndoResponseSchema,
      await ctx.live.undo(undo.id, {
        reason: undo.reason,
        allowPlayers: undo.allowPlayers,
        allowProtected: undo.allowProtected,
      }),
    );
  }
  throw new DaemonError(`Unknown route ${request.method} /live/${action}`, 404);
}

/** The response for a live failure, or null when the error is not live's. */
export function liveErrorResponse(
  error: unknown,
  log: Log,
  path: string,
): Response | null {
  if (error instanceof LiveError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof LiveGuardRefusal) {
    log("live write refused", { path, error: error.message });
    return Response.json(
      { error: `live write refused: ${error.message}` },
      { status: 403 },
    );
  }
  return null;
}
