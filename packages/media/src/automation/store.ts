import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";
import { queueIntervention } from "./notifications/interventions.ts";
import { routeNativeQuarantineOperation } from "#infrastructure/native-quarantine/continuation.ts";

export type WorkflowStart = {
  workflowType: string;
  workflowId: string;
  input: Prisma.JsonObject;
};
export type WorkflowStarter = (input: WorkflowStart) => Promise<void>;

export async function queueOperation(
  db: Prisma.TransactionClient,
  input: {
    key: string;
    kind: string;
    targetId: string;
    userId?: string;
    payload: Prisma.InputJsonObject;
  },
): Promise<string> {
  const existing = await db.operation.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing !== null) return existing.id;
  const id = crypto.randomUUID();
  const route = await routeNativeQuarantineOperation(db, input);
  const kind = route?.kind ?? input.kind;
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const payload = {
    operationId: id,
    kind,
    recoveryEpoch: runtime.recoveryEpoch,
    ...(route?.payload ?? input.payload),
  };
  await db.operation.create({
    data: {
      id,
      idempotencyKey: input.key,
      kind,
      targetId: input.targetId,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      payload,
      outbox: { create: { kind, payload } },
    },
  });
  if (route !== null)
    await db.nativeQuarantineContinuation.update({
      where: { id: route.continuationId },
      data: {
        coordinatorOperationId: id,
        state: route.state,
        version: { increment: 1 },
      },
    });
  return id;
}

const workflowTypes: Readonly<Record<string, string>> = {
  reverify_plex_binding: "reverifyPlexBindingWorkflow",
  prepare_native_compensation: "prepareNativeCompensationWorkflow",
  apply_native_compensation: "applyNativeCompensationWorkflow",
  compensate_native_publication: "compensateNativePublicationWorkflow",
  publish_compensated_media: "publishCompensatedMediaWorkflow",
  prepare_native_archive: "prepareNativeArchiveWorkflow",
  apply_native_archive: "applyNativeArchiveWorkflow",
  cleanup_native_archive: "cleanupNativeArchiveWorkflow",
  observe_plex_hint: "observePlexEventHintWorkflow",
  prepare_native_quarantine: "prepareNativeQuarantineWorkflow",
  apply_native_quarantine: "applyNativeQuarantineWorkflow",
  restore_native_quarantine: "restoreNativeQuarantineWorkflow",
  prepare_subtitle_replacement: "prepareSubtitleReplacementWorkflow",
  apply_subtitle_replacement: "applySubtitleReplacementWorkflow",
  reconcile_subtitle_replacement: "reconcileSubtitleReplacementWorkflow",
  cleanup_subtitle_replacement: "cleanupSubtitleReplacementWorkflow",
  prepare_native_recovery: "prepareNativeRecoveryWorkflow",
  apply_native_recovery: "applyNativeRecoveryWorkflow",
  prepare_handoff: "prepareMediaHandoffWorkflow",
  apply_handoff: "applyMediaHandoffWorkflow",
  apply_library_handoff_v3: "applyLibraryHandoffV3Workflow",
  plex_exclusion_prepare: "preparePlexExclusionWorkflow",
  plex_exclusion_execute: "executePlexExclusionWorkflow",
  plex_exclusion_recover: "recoverPlexExclusionWorkflow",
  expand_request: "expandMediaRequestWorkflow",
  refresh_catalog: "refreshMediaCatalogWorkflow",
  expand_catalog_requests: "expandCatalogRequestsWorkflow",
  reconcile_media: "reconcileMediaWorkflow",
  acquire_release: "reconcileMediaWorkflow",
  restore_media: "restoreMediaWorkflow",
  retain_media: "retainMediaWorkflow",
  acquire_subtitles: "acquireMediaSubtitlesWorkflow",
  maintain_torrent: "maintainMediaTorrentWorkflow",
  deliver_notification: "deliverMediaNotificationWorkflow",
  install_subtitle: "installMediaSubtitleWorkflow",
  cleanup_upgrade: "cleanupMediaUpgradeWorkflow",
};

export function createOutboxActivities(
  database: Database,
  start: WorkflowStarter,
): Pick<
  MediaNetworkActivities,
  "dispatchMediaOutbox" | "finishMediaOperation"
> {
  return {
    async dispatchMediaOutbox() {
      const commands = await database.outboxCommand.findMany({
        where: { dispatchedAt: null, availableAt: { lte: new Date() } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      let dispatched = 0;
      let deferred = 0;
      for (const command of commands) {
        const workflowType = workflowTypes[command.kind];
        if (workflowType === undefined)
          throw new Error("Unknown media outbox command kind");
        const payload = command.payload;
        if (
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload)
        )
          throw new TypeError("Media command payload must be an object");
        try {
          await start({
            workflowType,
            workflowId: `media-operation-${command.operationId}`,
            input: payload,
          });
          await database.outboxCommand.updateMany({
            where: { id: command.id, dispatchedAt: null },
            data: { dispatchedAt: new Date(), attempts: { increment: 1 } },
          });
          dispatched++;
        } catch {
          await database.outboxCommand.updateMany({
            where: { id: command.id, dispatchedAt: null },
            data: {
              attempts: { increment: 1 },
              availableAt: new Date(Date.now() + 60_000),
            },
          });
          deferred++;
        }
      }
      return { dispatched, deferred };
    },
    async finishMediaOperation(input) {
      await serializable(database, async (tx) => {
        const updated =
          await tx.$executeRaw`UPDATE "Operation" SET status = ${input.status}::"OperationStatus", result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ reason: input.reason })}::jsonb, "updatedAt" = NOW() WHERE id = ${input.operationId}`;
        if (updated !== 1) throw new Error("Media operation does not exist");
        if (input.status !== "completed")
          await queueIntervention(tx, input.operationId);
      });
    },
  };
}

export async function serializable<T>(
  db: Database,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: "Serializable",
        timeout: 30_000,
      });
    } catch (error) {
      if (isRetryableTransaction(error) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("Transaction retry bound was not enforced");
}
