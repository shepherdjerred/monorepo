import {
  FileGuardError,
  RemovalPlanSchema,
  type FileContext,
  type RemovalEntry,
  now,
} from "./types.ts";
import { assertRetention, assertRuntime, lockMedia } from "./guards.ts";
import { removalPlan, assertOwnedAsset } from "./removal-plan.ts";
import { fileOperations } from "./file-operations.ts";
import { z } from "zod";
import { prepareRemovalProof } from "./content-proof.ts";
import { Prisma } from "#generated/prisma/client.ts";
import {
  assertRestoredGenerations,
  recordRestoreReceipt,
} from "./restore-receipt.ts";

export async function removeFiles(
  initialContext: FileContext,
  decisionId: string,
  operationId: string,
  purge: boolean,
): Promise<void> {
  const enabled = purge
    ? initialContext.enabled.purge
    : initialContext.enabled.quarantine;
  if (!(await enabled())) throw new FileGuardError("retention_disabled");
  const plan = await initialContext.db.$transaction(async (tx) => {
    const decision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    });
    await lockMedia(tx, [decision.mediaId]);
    return await removalPlan(tx, initialContext, decisionId);
  });
  const context = await prepareRemovalProof(initialContext, plan);
  const mediaIds = [...new Set(plan.flatMap((entry) => entry.mediaIds))];
  await context.db.$transaction(
    async (tx) => {
      await lockMedia(tx, mediaIds);
      const decision = await tx.retentionDecision.findUniqueOrThrow({
        where: { id: decisionId },
      });
      const completeState = purge ? "purged" : "quarantined";
      if (decision.state === completeState) return;
      for (const entry of plan) {
        const authorize = async () => {
          await context.checkpoint("retention-authorization");
          if (!(await enabled()))
            throw new FileGuardError("retention_disabled");
          await assertRetention({
            tx,
            context,
            decisionId,
            mediaIds: entry.mediaIds,
            generations: entry.generations,
            purge,
          });
          await assertOwnedAsset(
            tx,
            entry,
            purge ? "quarantined" : "published",
          );
        };
        await authorize();
        const operations = fileOperations(
          context,
          context.roots[entry.libraryKind],
          authorize,
        );
        await removeEntry(operations, entry, operationId, purge);
      }
      for (const entry of plan) {
        await tx.libraryAsset.update({
          where: { id: entry.assetId },
          data: { state: completeState, version: { increment: 1 } },
        });
        await tx.subtitleAsset.updateMany({
          where: {
            assetId: entry.assetId,
            state: purge ? "quarantined" : "installed",
          },
          data: { state: completeState },
        });
        if (purge)
          await tx.assetCoverage.updateMany({
            where: { assetId: entry.assetId },
            data: { current: false },
          });
      }
      const timestamp = now(context);
      await tx.retentionDecision.updateMany({
        where: {
          mediaId: { in: mediaIds },
          state: purge ? "quarantined" : "grace_period",
        },
        data: {
          state: completeState,
          manifest: { assets: plan },
          version: { increment: 1 },
          ...(purge
            ? {}
            : {
                quarantinedAt: timestamp,
                purgeAfter: new Date(timestamp.getTime() + 7 * 86_400_000),
              }),
        },
      });
      await tx.mediaItem.updateMany({
        where: { id: { in: mediaIds } },
        data: {
          availability: purge ? "removed" : "quarantined",
          version: { increment: 1 },
        },
      });
      await tx.applicationEvent.createMany({
        data: mediaIds.map((mediaId) => ({
          mediaId,
          kind: `files_${completeState}`,
          payload: { decisionId },
        })),
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function removeEntry(
  operations: ReturnType<typeof fileOperations>,
  entry: RemovalEntry,
  operationId: string,
  purge: boolean,
): Promise<void> {
  for (const file of [...entry.sidecars, entry]) {
    const descriptor = {
      operationId: `${operationId}-${purge ? "purge" : "quarantine"}-${file.quarantineId}`,
      quarantineId: file.quarantineId,
      libraryPath: file.libraryPath,
      sha256: file.checksum,
    };
    if (purge) await operations.purge(descriptor);
    else await operations.quarantine(descriptor);
  }
}

export async function restoreFiles(
  initialContext: FileContext,
  mediaId: string,
  operationId: string,
): Promise<boolean> {
  if (!(await initialContext.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const decision = await initialContext.db.retentionDecision.findFirst({
    where: {
      mediaId,
      state: { in: ["quarantined", "restored", "grace_period", "cancelled"] },
      manifest: { not: Prisma.DbNull },
    },
    orderBy: { createdAt: "desc" },
  });
  if (decision === null) return false;
  const plan = RemovalPlanSchema.parse(decision.manifest).assets;
  const context = await prepareRemovalProof(initialContext, plan);
  const mediaIds = [...new Set(plan.flatMap((entry) => entry.mediaIds))];
  await context.db.$transaction(
    async (tx) => {
      await lockMedia(tx, mediaIds);
      const currentDecision = await tx.retentionDecision.findUniqueOrThrow({
        where: { id: decision.id },
      });
      if (
        JSON.stringify(
          RemovalPlanSchema.parse(currentDecision.manifest).assets,
        ) !== JSON.stringify(plan)
      )
        throw new FileGuardError("restore_plan_changed");
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: operationId },
      });
      const payload = z
        .object({ mediaId: z.string(), generation: z.number().int() })
        .parse(operation.payload);
      if (operation.kind !== "restore_media" || payload.mediaId !== mediaId)
        throw new FileGuardError("restore_operation_invalid");
      const intent = await tx.mediaIntent.findUniqueOrThrow({
        where: { mediaId },
      });
      if (!intent.desiredPresence || intent.generation !== payload.generation)
        throw new FileGuardError("intent_obsolete");
      const epoch = z
        .object({ recoveryEpoch: z.number().int() })
        .parse(currentDecision.evidence).recoveryEpoch;
      if (currentDecision.state === "restored") {
        await assertRestoredGenerations(tx, mediaIds, currentDecision.evidence);
        await recordRestoreReceipt({
          tx,
          context,
          decisionId: currentDecision.id,
          operationId,
          mediaIds,
          recoveryEpoch: epoch,
          plan,
        });
        return;
      }
      if (
        !["quarantined", "grace_period", "cancelled"].includes(
          currentDecision.state,
        )
      )
        throw new FileGuardError("decision_obsolete");
      for (const entry of plan) {
        const authorize = async () => {
          await context.checkpoint("restore-authorization");
          if (!(await context.enabled.acquisition()))
            throw new FileGuardError("acquisition_disabled");
          await assertRuntime(tx, epoch);
          await assertOwnedAsset(
            tx,
            entry,
            currentDecision.state === "quarantined"
              ? "quarantined"
              : "published",
          );
        };
        await authorize();
        await restoreEntry(context, entry, operationId, authorize);
        await tx.libraryAsset.update({
          where: { id: entry.assetId },
          data: { state: "published", version: { increment: 1 } },
        });
        await tx.subtitleAsset.updateMany({
          where: { assetId: entry.assetId, state: "quarantined" },
          data: { state: "installed" },
        });
      }
      const proof = z
        .record(z.string(), z.json())
        .parse(currentDecision.evidence);
      const restoredIntents = await tx.mediaIntent.findMany({
        where: { mediaId: { in: mediaIds } },
      });
      const restoredGenerations = Object.fromEntries(
        restoredIntents.map((restoredIntent) => [
          restoredIntent.mediaId,
          restoredIntent.generation,
        ]),
      );
      await tx.retentionDecision.updateMany({
        where: {
          mediaId: { in: mediaIds },
          state: { in: ["quarantined", "grace_period", "cancelled"] },
        },
        data: {
          state: "restored",
          evidence: {
            ...proof,
            restoreOperationId: operationId,
            restoredGenerations,
          },
          version: { increment: 1 },
        },
      });
      await tx.mediaItem.updateMany({
        where: { id: { in: mediaIds } },
        data: { availability: "importing", version: { increment: 1 } },
      });
      await recordRestoreReceipt({
        tx,
        context,
        decisionId: currentDecision.id,
        operationId,
        mediaIds,
        recoveryEpoch: epoch,
        plan,
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return true;
}

async function restoreEntry(
  context: FileContext,
  entry: RemovalEntry,
  operationId: string,
  authorize: () => Promise<void>,
): Promise<void> {
  const operations = fileOperations(
    context,
    context.roots[entry.libraryKind],
    authorize,
  );
  await operations.restore({
    operationId: `${operationId}-restore-${entry.quarantineId}`,
    quarantineId: entry.quarantineId,
    libraryPath: entry.libraryPath,
    sha256: entry.checksum,
  });
  for (const sidecar of entry.sidecars)
    await operations.restore({
      operationId: `${operationId}-restore-${sidecar.quarantineId}`,
      quarantineId: sidecar.quarantineId,
      libraryPath: sidecar.libraryPath,
      sha256: sidecar.checksum,
    });
}
