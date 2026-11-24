import { z } from "zod";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import path from "node:path";
import { queueOperation, serializable } from "#automation/store.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { reconcileUnconfirmedSubmission } from "#automation/acquisition-management/recovery.ts";
import { sweepSubtitleReplacements } from "#infrastructure/subtitle-replacement/sweep.ts";
import { acquisitionInvocation } from "#automation/acquisition-management/invocation.ts";
import { managedAttemptAuthority } from "#automation/acquisition-management/attempt.ts";
import { recordedAcquisitionIdentity } from "#shared/acquisition/recorded-identity.ts";
import { MediaError } from "#application/errors.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { queueTerminalMovieRetryV4 } from "#automation/movie-editions/retry/sweep.ts";
import {
  PLEX_EXCLUSION_PROOF_REQUIRED,
  hasLibraryPlexExclusionDatabaseProof,
} from "#automation/plex-exclusion/proof.ts";

const failedStatuses = new Set([
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
]);

export async function sweepDownloads(
  initial: MediaAutomationContext,
  cursor: string | null,
) {
  const context = movieManagementContext(initial);
  if (cursor === null) {
    await context.refreshWriterLease();
    await context.refreshExclusionProofs();
    await sweepSubtitleReplacements(context);
    const runtime = await requireActiveRuntime(context.db);
    if (!runtime.active) await settleUnstartedAcquisitionHolds(context.db);
  }
  return await sweepDownloadAttempts(context, cursor);
}

/**
 * The audited inactive-runtime inventory: reconciling reconcile_media commands
 * whose recorded reason is acquisition_disabled and which never reserved an
 * attempt. Other kinds stay untouched. Completing them records runtime_observe
 * and does not retry an external write.
 */
export async function settleUnstartedAcquisitionHolds(
  db: MediaAutomationContext["db"],
): Promise<number> {
  return db.$executeRaw`
    UPDATE "Operation" AS operation
    SET status = 'completed'::"OperationStatus",
        result = COALESCE(operation.result, '{}'::jsonb) || jsonb_build_object('reason', 'runtime_observe'),
        "updatedAt" = NOW()
    WHERE operation.kind = 'reconcile_media'
      AND operation.status = 'reconciling'
      AND operation.result->>'reason' = 'acquisition_disabled'
      AND NOT EXISTS (
        SELECT 1 FROM "AcquisitionAttempt" AS attempt
        WHERE attempt."operationId" = operation.id
           OR attempt."coordinatorOperationId" = operation.id
      )
  `;
}

async function sweepDownloadAttempts(
  context: MediaAutomationContext,
  cursor: string | null,
) {
  const attempts = await context.db.acquisitionAttempt.findMany({
    where: {
      OR: [
        { edition: "default" },
        { identityEvidence: { path: ["schemaVersion"], equals: 2 } },
        { identityEvidence: { path: ["schemaVersion"], equals: 3 } },
      ],
      ...(cursor === null ? {} : { id: { gt: cursor } }),
      state: { notIn: ["completed", "obsolete", "rejected"] },
    },
    orderBy: { id: "asc" },
    // A movie's identity, uncertain-add reconciliation and terminal recovery
    // share this Activity's 100-record allowance. Continue before the next attempt.
    take: 1,
    include: { torrent: true },
  });
  const runtime = await requireActiveRuntime(context.db);
  for (const attempt of attempts)
    await sweepDownloadAttempt(context, attempt, runtime);
  return {
    processed: attempts.length,
    nextCursor: attempts.length === 1 ? (attempts.at(-1)?.id ?? null) : null,
  };
}

async function sweepDownloadAttempt(
  context: MediaAutomationContext,
  attempt: Prisma.AcquisitionAttemptGetPayload<{ include: { torrent: true } }>,
  runtime: Awaited<ReturnType<typeof requireActiveRuntime>>,
) {
  if (!runtime.active || attempt.recoveryEpoch !== runtime.epoch) return;
  const recorded = recordedAcquisitionIdentity(attempt.identityEvidence);
  if (
    recorded !== null &&
    (recorded.schemaVersion === 2 || recorded.schemaVersion === 3)
  ) {
    context.movieManagement?.budget.consume(
      1 + (attempt.torrent === null ? 0 : 1),
    );
    await reconcileUnconfirmedSubmission(
      context,
      attempt.id,
      context.movieManagement?.budget,
    );
    await queueTerminalMovieRetryV4(context, {
      attemptId: attempt.id,
      scope: recorded.scope,
    });
    return;
  }
  await sweepOrdinaryDownloadAttempt(context, attempt, runtime.epoch);
}

async function ordinaryExclusionGate(
  context: MediaAutomationContext,
  observedAttempt: AcquisitionAttempt,
  coordinatorId: string,
): Promise<{ allowed: boolean; blockedOnExclusion: boolean }> {
  const coordinator = await context.db.operation.findUnique({
    where: { id: coordinatorId },
    select: { status: true, result: true },
  });
  const blockedOnExclusion =
    coordinator?.status === "reconciling" &&
    z
      .object({ reason: z.literal(PLEX_EXCLUSION_PROOF_REQUIRED) })
      .safeParse(coordinator.result).success;
  if (observedAttempt.state === "imported")
    return { allowed: true, blockedOnExclusion };
  const item = await context.db.mediaItem.findFirst({
    where: { id: { in: observedAttempt.mediaIds } },
    select: { kind: true },
  });
  if (item === null) {
    throw new Error(
      `Acquisition attempt ${observedAttempt.id} has no existing media item`,
    );
  }
  const libraryKind = item.kind === "movie" ? "movies" : "tv";
  const allowed = await hasLibraryPlexExclusionDatabaseProof(
    context.db,
    libraryKind,
  );
  return { allowed, blockedOnExclusion };
}

async function sweepOrdinaryDownloadAttempt(
  context: MediaAutomationContext,
  attempt: Prisma.AcquisitionAttemptGetPayload<{ include: { torrent: true } }>,
  epoch: number,
) {
  await reconcileUnconfirmedSubmission(context, attempt.id);
  const observedAttempt = await context.db.acquisitionAttempt.findUniqueOrThrow(
    { where: { id: attempt.id }, include: { torrent: true } },
  );
  if (observedAttempt.torrent !== null)
    await observeDownload(context, {
      ...observedAttempt.torrent,
      attemptId: attempt.id,
      operationId: attempt.operationId,
      sourcePath: path.join(context.downloadRoot, "media", attempt.id),
    });
  const coordinatorId = attempt.coordinatorOperationId ?? attempt.operationId;
  const gate = await ordinaryExclusionGate(
    context,
    observedAttempt,
    coordinatorId,
  );
  if (!gate.allowed) return;
  const root = await context.describeWorkflow(
    `media-operation-${coordinatorId}`,
  );
  if (
    root === null ||
    (!failedStatuses.has(root.status) &&
      !(gate.blockedOnExclusion && root.status === "COMPLETED"))
  )
    return;
  const child = await context.describeWorkflow(`media-acquire-${attempt.id}`);
  if (
    child !== null &&
    child.status !== "COMPLETED" &&
    !failedStatuses.has(child.status)
  )
    return;
  // Missing history is only safe before any external effect could begin.
  if (child === null && observedAttempt.state !== "reserved") return;
  await recoverTerminalCoordinator(context, observedAttempt, {
    coordinatorId,
    rootRunId: root.runId,
    rootStatus: root.status,
    childRunId: child?.runId ?? "unstarted",
    epoch,
  });
}

async function recoverTerminalCoordinator(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  terminal: {
    coordinatorId: string;
    rootRunId: string;
    rootStatus: string;
    childRunId: string;
    epoch: number;
  },
) {
  const identity = recordedAcquisitionIdentity(attempt.identityEvidence);
  const managed = identity?.schemaVersion === 4;
  const invocation = managed
    ? await acquisitionInvocation(context, { attemptId: attempt.id })
    : context;
  await serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, attempt.mediaIds);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: attempt.mediaIds,
    });
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
      state.recoveryEpoch !== terminal.epoch ||
      (current.coordinatorOperationId ?? current.operationId) !==
        terminal.coordinatorId
    )
      return;
    const mediaId = current.mediaIds[0];
    if (mediaId === undefined)
      throw new Error("Acquisition has no media coverage");
    const intent = await tx.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(mediaId)),
    });
    await tx.operation.update({
      where: { id: terminal.coordinatorId },
      data: { status: "reconciling" },
    });
    await tx.applicationEvent.create({
      data: {
        mediaId,
        kind: "acquisition_coordinator_terminal",
        payload: {
          attemptId: current.id,
          operationId: terminal.coordinatorId,
          workflowRunId: terminal.rootRunId,
          status: terminal.rootStatus,
        },
      },
    });
    if (!intent.desiredPresence || !intent.monitoring) return;
    if (managed) {
      try {
        if (!(await managedAttemptAuthority(tx, invocation, current))) return;
      } catch (error) {
        if (
          !(error instanceof MediaError) ||
          error.code !== "library_management_unconfirmed"
        )
          throw error;
        return;
      }
    } else {
      const claims = await tx.mediaRequest.count({
        where: { mediaId, ...effectiveRequestWhere },
      });
      if (claims === 0) return;
    }
    await queueOperation(tx, {
      key: `recover:${current.id}:${terminal.rootRunId}:${terminal.childRunId}:${String(terminal.epoch)}`,
      kind: "reconcile_media",
      targetId: mediaId,
      payload: { mediaId, generation: intent.generation },
    });
    if (managed) invocation.libraryManagement?.freshness.assertActive();
  });
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
