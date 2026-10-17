import type { MediaAutomationContext } from "#automation/context.ts";
import path from "node:path";
import { queueOperation, serializable } from "#automation/store.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { reconcileUnconfirmedSubmission } from "#automation/acquisition-submission.ts";

const failedStatuses = new Set([
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
]);

export async function sweepDownloads(
  context: MediaAutomationContext,
  cursor: string | null,
) {
  if (cursor === null) await context.refreshExclusionProofs();
  return await sweepDownloadAttempts(context, cursor);
}

async function sweepDownloadAttempts(
  context: MediaAutomationContext,
  cursor: string | null,
) {
  const attempts = await context.db.acquisitionAttempt.findMany({
    where: {
      ...(cursor === null ? {} : { id: { gt: cursor } }),
      state: { notIn: ["completed", "obsolete", "rejected"] },
    },
    orderBy: { id: "asc" },
    take: 25,
    include: { torrent: true },
  });
  const runtime = await requireActiveRuntime(context.db);
  for (const attempt of attempts) {
    if (!runtime.active || attempt.recoveryEpoch !== runtime.epoch) continue;
    await reconcileUnconfirmedSubmission(context, attempt.id);
    const observedAttempt =
      await context.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { torrent: true },
      });
    if (observedAttempt.torrent !== null)
      await observeDownload(context, {
        ...observedAttempt.torrent,
        attemptId: attempt.id,
        operationId: attempt.operationId,
        sourcePath: path.join(context.downloadRoot, "media", attempt.id),
      });
    const coordinatorId = attempt.coordinatorOperationId ?? attempt.operationId;
    const root = await context.describeWorkflow(
      `media-operation-${coordinatorId}`,
    );
    if (root === null || !failedStatuses.has(root.status)) continue;
    const child = await context.describeWorkflow(`media-acquire-${attempt.id}`);
    if (
      child !== null &&
      child.status !== "COMPLETED" &&
      !failedStatuses.has(child.status)
    )
      continue;
    // Missing history is only safe before any external effect could begin.
    if (child === null && attempt.state !== "reserved") continue;
    await serializable(context.db, async (tx) => {
      await lockMedia(tx, attempt.mediaIds);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      const state = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (
        state.mode !== "active" ||
        !state.ownershipConfirmed ||
        state.recoveryEpoch !== runtime.epoch ||
        (current.coordinatorOperationId ?? current.operationId) !==
          coordinatorId
      )
        return;
      const mediaId = current.mediaIds[0];
      if (mediaId === undefined)
        throw new Error("Acquisition has no media coverage");
      const intent = await tx.mediaIntent.findUniqueOrThrow({
        where: { mediaId },
      });
      const claims = await tx.mediaRequest.count({
        where: { mediaId, ...effectiveRequestWhere },
      });
      await tx.operation.update({
        where: { id: coordinatorId },
        data: { status: "reconciling" },
      });
      await tx.applicationEvent.create({
        data: {
          mediaId,
          kind: "acquisition_coordinator_terminal",
          payload: {
            attemptId: current.id,
            operationId: coordinatorId,
            workflowRunId: root.runId,
            status: root.status,
          },
        },
      });
      if (claims === 0 || !intent.desiredPresence || !intent.monitoring) return;
      await queueOperation(tx, {
        key: `recover:${current.id}:${root.runId}:${child?.runId ?? "unstarted"}:${String(runtime.epoch)}`,
        kind: "reconcile_media",
        targetId: mediaId,
        payload: { mediaId, generation: intent.generation },
      });
    });
  }
  return {
    processed: attempts.length,
    nextCursor: attempts.length === 25 ? (attempts.at(-1)?.id ?? null) : null,
  };
}

async function observeDownload(
  context: MediaAutomationContext,
  torrent: {
    id: string;
    infoHash: string;
    owned: boolean;
    operationId: string;
    sourcePath: string | null;
    attemptId: string;
  },
) {
  if (!torrent.owned || torrent.sourcePath === null) return;
  await context.qbittorrent.login();
  const observed = await context.qbittorrent.observe(torrent.infoHash);
  if (observed === null) {
    await context.db.torrent.update({
      where: { id: torrent.id },
      data: { state: "missing", observedAt: new Date() },
    });
    return;
  }
  context.qbittorrent.validateOwnership(observed, {
    attemptId: torrent.attemptId,
    operationId: torrent.operationId,
    savePath: torrent.sourcePath,
  });
  const files =
    observed.progress === 1
      ? await context.qbittorrent.files(observed.hash)
      : [];
  await serializable(context.db, async (tx) => {
    await tx.torrent.update({
      where: { id: torrent.id },
      data: {
        observation: { torrent: observed, files },
        observedAt: new Date(),
      },
    });
    await queueOperation(tx, {
      key: `seed:${torrent.id}`,
      kind: "maintain_torrent",
      targetId: torrent.id,
      payload: { torrentId: torrent.id },
    });
  });
}
