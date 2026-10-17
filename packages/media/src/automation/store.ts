import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";

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
  const payload = { operationId: id, kind: input.kind, ...input.payload };
  await db.operation.create({
    data: {
      id,
      idempotencyKey: input.key,
      kind: input.kind,
      targetId: input.targetId,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      payload,
      outbox: { create: { kind: input.kind, payload } },
    },
  });
  return id;
}

const workflowTypes: Readonly<Record<string, string>> = {
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
      const updated =
        await database.$executeRaw`UPDATE "Operation" SET status = ${input.status}::"OperationStatus", result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ reason: input.reason })}::jsonb, "updatedAt" = NOW() WHERE id = ${input.operationId}`;
      if (updated !== 1) throw new Error("Media operation does not exist");
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
