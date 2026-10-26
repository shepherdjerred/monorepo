import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import {
  FileGuardError,
  RemovalPlanSchema,
  type FileContext,
  type RemovalEntry,
} from "./types.ts";
import { prepareRemovalProof } from "./content-proof.ts";
import {
  assertRuntime,
  assertNoMediaSubtitleReplacement,
  lockMedia,
} from "./guards.ts";
import { assertOwnedAsset } from "./removal-plan.ts";
import { advanceSubtitleBindings } from "./subtitle-lifecycle/ownership.ts";
import { fileOperations } from "./file-operations.ts";
import {
  assertRestoredGenerations,
  recordRestoreReceipt,
} from "./restore-receipt.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { lockRemovalAuthority } from "./plex-binding/locks.ts";

export async function restoreFiles(
  initialContext: FileContext,
  mediaId: string,
  operationId: string,
): Promise<boolean> {
  const execution = initialContext.publicationExecution?.();
  execution?.assertActive();
  if (!(await initialContext.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const decision = await initialContext.db.retentionDecision.findFirst({
    where: {
      edition: "default",
      mediaId,
      state: { in: ["quarantined", "restored", "grace_period", "cancelled"] },
      manifest: { not: Prisma.DbNull },
    },
    orderBy: { createdAt: "desc" },
  });
  if (decision === null) return false;
  const plan = RemovalPlanSchema.parse(decision.manifest).assets;
  const invocation =
    decision.state === "restored"
      ? null
      : publicationInvocation(
          initialContext,
          requirePublicationExecution(execution),
        );
  const context = await prepareRemovalProof(invocation ?? initialContext, plan);
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
        where: targetWhere(defaultScope(mediaId)),
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
      if (invocation === null)
        throw new FileGuardError("restore_state_changed");
      await lockRemovalAuthority(tx, {
        plan,
        epoch,
        access: [],
        evidence: currentDecision.evidence,
      });
      const deadlines: (() => void)[] = [];
      for (const entry of plan) {
        const authorize = async () => {
          await context.checkpoint("restore-authorization");
          await assertPublicationUnfenced(tx, entry.mediaIds, [entry.assetId]);
          if (!(await context.enabled.acquisition()))
            throw new FileGuardError("acquisition_disabled");
          await assertRuntime(tx, epoch);
          await assertNoMediaSubtitleReplacement(tx, entry.mediaIds);
          if (
            !(await recordsAuthorized(tx, {
              epoch,
              mediaIds: entry.mediaIds,
              assetIds: [entry.assetId],
            }))
          )
            throw new FileGuardError("record_ownership_unconfirmed");
          await assertOwnedAsset(
            tx,
            entry,
            currentDecision.state === "quarantined"
              ? "quarantined"
              : "published",
          );
        };
        await authorize();
        const freshness = await publicationAuthorityDeadline(
          tx,
          { ...context, execution: invocation.execution },
          {
            libraryKind: entry.libraryKind,
            recoveryEpoch: epoch,
          },
        );
        await bindPlexTransactionDeadline(tx, freshness);
        deadlines.push(freshness.assertActive);
        const previousAsset = await tx.libraryAsset.findUniqueOrThrow({
          where: { id: entry.assetId },
        });
        await restoreEntry(context, entry, operationId, {
          authorize,
          beforeEffect: () => {
            freshness.assertActive();
          },
        });
        const restoredAsset = await tx.libraryAsset.update({
          where: { id: entry.assetId },
          data: { state: "published", version: { increment: 1 } },
        });
        await advanceSubtitleBindings(tx, {
          assetId: entry.assetId,
          checksum: entry.checksum,
          epoch,
          fromVersion: previousAsset.version,
          toVersion: restoredAsset.version,
          fromState:
            previousAsset.state === "quarantined" ? "quarantined" : "installed",
          sidecarIds: entry.sidecars.map((item) => item.subtitleId),
          state: "installed",
        });
      }
      const proof = z
        .record(z.string(), z.json())
        .parse(currentDecision.evidence);
      const restoredIntents = await tx.mediaIntent.findMany({
        where: { mediaId: { in: mediaIds }, edition: "default" },
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
          edition: "default",
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
      await mirrorDefaultAvailability(tx, mediaIds, "importing");
      await recordRestoreReceipt({
        tx,
        context,
        decisionId: currentDecision.id,
        operationId,
        mediaIds,
        recoveryEpoch: epoch,
        plan,
      });
      for (const assertActive of deadlines) assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return true;
}

async function restoreEntry(
  context: FileContext,
  entry: RemovalEntry,
  operationId: string,
  guards: { authorize: () => Promise<void>; beforeEffect: () => void },
): Promise<void> {
  const operations = fileOperations(
    context,
    context.roots[entry.libraryKind],
    guards.authorize,
    guards.beforeEffect,
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
