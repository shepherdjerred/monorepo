import { z } from "zod";
import type { SubtitleReplacement } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError } from "#application/errors.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { SubtitleReplacementSnapshotSchema } from "#shared/subtitle-replacement.ts";
import { assertReplacementCoordinatorTerminal } from "./terminal.ts";
import { lockSubtitleReplacementScope } from "./locks.ts";
type SweepContext = Pick<MediaAutomationContext, "db" | "describeWorkflow">;

/** One durable 25-row page per download tick; protected rows cannot starve later IDs. */
export async function sweepSubtitleReplacements(context: SweepContext) {
  const authority = await runtimeAuthority(context.db);
  if (!authority.active) return;
  const scan = await context.db.reconciliationScan.upsert({
    where: { id: "subtitle-replacement-sweep" },
    create: {
      id: "subtitle-replacement-sweep",
      kind: "subtitle_replacements",
      progress: { cursor: null },
    },
    update: {},
  });
  const progress = z
    .object({ cursor: z.uuid().nullable() })
    .parse(scan.progress);
  const rows = await context.db.subtitleReplacement.findMany({
    where: {
      recoveryEpoch: authority.epoch,
      ...(progress.cursor === null ? {} : { id: { gt: progress.cursor } }),
      OR: [
        { reservationActive: true, state: { not: "protected" } },
        {
          cleanupState: { not: "cleaned" },
          archiveExpiresAt: { lte: new Date() },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: 25,
    include: { review: true },
  });
  for (const row of rows) {
    if (row.reservationActive) {
      if (
        row.state === "awaiting_review" &&
        row.review !== null &&
        row.review.expiresAt > new Date()
      )
        continue;
      await queueInterrupted(context, row);
    } else await queueDueCleanup(context, row.id);
  }
  await context.db.reconciliationScan.updateMany({
    where: { id: scan.id, progress: { equals: { cursor: progress.cursor } } },
    data: {
      progress: {
        cursor: rows.length === 25 ? (rows.at(-1)?.id ?? null) : null,
      },
    },
  });
}
async function queueInterrupted(
  context: SweepContext,
  row: SubtitleReplacement,
) {
  try {
    const proof = await assertReplacementCoordinatorTerminal(
      context.db,
      context.describeWorkflow,
      row.id,
    );
    await serializable(context.db, async (tx) => {
      const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
      await lockSubtitleReplacementScope(tx, {
        assetId: row.assetId,
        mediaIds: scope.asset.coverage.map((item) => item.mediaId),
        replacementId: row.id,
      });
      const current = await tx.subtitleReplacement.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (current.version !== proof.version || !current.reservationActive)
        return;
      await tx.subtitleReplacement.update({
        where: { id: row.id },
        data: { state: "reconciling", version: { increment: 1 } },
      });
      const operationId = await queueOperation(tx, {
        key: `subtitle-replacement-reconcile:${row.id}:${String(current.version)}`,
        kind: "reconcile_subtitle_replacement",
        targetId: row.id,
        payload: { replacementId: row.id, coordinators: proof.executions },
      });
      await tx.subtitleReplacement.update({
        where: { id: row.id },
        data: { coordinatorOperationId: operationId },
      });
    });
  } catch (error) {
    if (!(error instanceof MediaError)) throw error;
  }
}
async function queueDueCleanup(context: SweepContext, id: string) {
  const prior = await context.db.operation.findFirst({
    where: { kind: "cleanup_subtitle_replacement", targetId: id },
    orderBy: { createdAt: "desc" },
  });
  const observed =
    prior === null
      ? null
      : await context.describeWorkflow(`media-operation-${prior.id}`);
  if (
    prior !== null &&
    (observed === null ||
      !["COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"].includes(
        observed.status,
      ))
  )
    return;
  await serializable(context.db, async (tx) => {
    const current = await tx.subtitleReplacement.findUniqueOrThrow({
      where: { id },
      include: { receipt: true },
    });
    if (
      current.reservationActive ||
      current.receipt === null ||
      current.cleanupState === "cleaned" ||
      current.archiveExpiresAt === null ||
      current.archiveExpiresAt > new Date()
    )
      return;
    await queueOperation(tx, {
      key: `subtitle-replacement-cleanup:${id}:${observed?.runId ?? "initial"}`,
      kind: "cleanup_subtitle_replacement",
      targetId: id,
      payload: { replacementId: id, recoveryEpoch: current.recoveryEpoch },
    });
  });
}
