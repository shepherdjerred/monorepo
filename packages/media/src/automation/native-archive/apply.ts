import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveContinuationSchema,
  NativeArchiveNetworkEvidenceSchema,
  type NativeArchiveBinding,
} from "#shared/native-recovery/archive.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
import {
  stableArchiveFiles,
  stableArchiveNetwork,
} from "#infrastructure/native-archive/plan.ts";
import { nativePhysicalIdentity } from "#infrastructure/native-archive/physical-identity.ts";
import { assertArchiveAuthority } from "#infrastructure/native-archive/authority.ts";
import { commitArchiveSupersessions } from "#infrastructure/native-archive/supersession.ts";
import {
  assertNativeEvidenceFresh,
  installNativeAuthority,
  nativeApprovingActor,
} from "#automation/native-recovery/authority.ts";
import { appendNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import type { PreparedNativeArchive } from "./files.ts";
import { withArchiveLocks } from "./physical.ts";
import { rebindArchiveSubtitles } from "./subtitles.ts";

async function rebindFiles(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  prepared: PreparedNativeArchive,
  epoch: number,
) {
  const bindings: NativeArchiveBinding[] = [];
  for (const file of prepared.scope.files) {
    assertArchiveActive(context.execution);
    if (file.authority.kind !== "rebaseline") {
      await assertArchiveAuthority(
        tx,
        file,
        file.authority,
        prepared.authorityProof.budget,
      );
      continue;
    }
    if (file.ownershipEpoch >= epoch)
      throw new Error("Archive requires a real prior-epoch transition");
    const evidence = prepared.evidence.files.find(
      (item) => item.assetId === file.assetId,
    );
    if (evidence === undefined)
      throw new Error("Archive physical evidence missing");
    await tx.libraryAsset.update({
      where: { id: file.assetId },
      data: { ownershipEpoch: epoch, version: { increment: 1 } },
    });
    assertArchiveActive(context.execution);
    const subtitles = await rebindArchiveSubtitles(
      tx,
      file,
      epoch,
      file.assetVersion + 1,
    );
    bindings.push({
      assetId: file.assetId,
      beforeVersion: file.assetVersion,
      assetVersion: file.assetVersion + 1,
      checksum: file.checksum,
      mediaIds: file.mediaIds,
      ownershipEpoch: epoch,
      subtitles,
      physicalIdentityHash: snapshotHash(nativePhysicalIdentity(evidence)),
    });
  }
  assertArchiveActive(context.execution);
  return bindings;
}

export async function applyPreparedNativeArchive(
  context: ArchiveFileContext,
  input: { planId: string; operationId: string; planHash: string },
  prepared: PreparedNativeArchive,
) {
  assertArchiveActive(context.execution);
  return await context.files.db.$transaction(
    async (tx) => {
      await lockNativeArchiveScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${input.planId} FOR UPDATE`;
      assertArchiveActive(context.execution);
      const previous = await tx.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (previous !== null) {
        if (previous.planHash !== input.planHash)
          throw new Error("Archive receipt does not match requested plan");
        await nativeApprovingActor(
          tx,
          input,
          previous.planHash,
          "apply_native_archive",
        );
        assertArchiveActive(context.execution);
        return previous.id;
      }
      const { plan, runtime } = await assertNativeArchiveSnapshot(
        tx,
        input.planId,
        prepared.scope,
      );
      if (
        plan.state !== "applying" ||
        plan.planHash !== input.planHash ||
        plan.expiresAt === null ||
        plan.expiresAt <= new Date()
      )
        throw new Error("Archive approval missing or expired");
      const finished = FinishedNativeV2Schema.parse(plan.plan);
      if (
        finished.lifecycleKind !== "superseded_archive" ||
        snapshotHash(finished) !== plan.planHash ||
        finished.scopeHash !== snapshotHash(z.json().parse(prepared.scope)) ||
        snapshotHash(finished.files) !==
          snapshotHash(z.json().parse(stableArchiveFiles(prepared.evidence)))
      )
        throw new Error("Archive reviewed physical identity changed");
      const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId: plan.id, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = NativeArchiveNetworkEvidenceSchema.parse(
        observation.evidence,
      );
      if (
        network.planId !== plan.id ||
        network.recoveryEpoch !== runtime.recoveryEpoch ||
        observation.expiresAt <= new Date() ||
        observation.evidenceHash !== snapshotHash(z.json().parse(network)) ||
        snapshotHash(finished.network) !==
          snapshotHash(stableArchiveNetwork(network))
      )
        throw new Error("Archive reviewed network identity changed");
      const actorId = await nativeApprovingActor(
        tx,
        input,
        plan.planHash,
        "apply_native_archive",
      );
      const receiptId = await withArchiveLocks(context, prepared, async () => {
        await installNativeAuthority(tx, context, {
          scope: prepared.scope,
          network,
        });
        assertArchiveActive(context.execution);
        const bindings = await rebindFiles(
          tx,
          context,
          prepared,
          runtime.recoveryEpoch,
        );
        const renewedMedia = new Set(
          bindings.flatMap((binding) => binding.mediaIds),
        );
        const reusedBindings = prepared.scope.files.flatMap((file) =>
          file.authority.kind === "rebaseline" ? [] : [file.authority],
        );
        const policies = await appendNativeSubtitlePolicies(tx, {
          policies: prepared.scope.subtitlePolicies.filter((policy) =>
            renewedMedia.has(policy.mediaId),
          ),
          epoch: runtime.recoveryEpoch,
          actorId,
          planId: plan.id,
        });
        for (const mediaId of [...renewedMedia].sort()) {
          await tx.recoveryHold.upsert({
            where: targetWhere(defaultScope(mediaId)),
            create: {
              mediaId,
              recoveryEpoch: runtime.recoveryEpoch,
              reason: "recovery_request_history_unconfirmed",
            },
            update: {
              recoveryEpoch: runtime.recoveryEpoch,
              reason: "recovery_request_history_unconfirmed",
              releasedAt: null,
              releasedById: null,
              releaseEvidence: Prisma.DbNull,
              version: { increment: 1 },
            },
          });
          assertArchiveActive(context.execution);
        }
        const runtimeChanged =
          bindings.length > 0 ||
          prepared.scope.request.activation === "activate";
        if (runtimeChanged)
          await tx.mediaRuntimeState.update({
            where: { id: "singleton" },
            data: {
              mode: "active",
              ownershipConfirmed: true,
              version: { increment: 1 },
            },
          });
        assertArchiveActive(context.execution);
        const receipt = await tx.nativeRecoveryReceipt.create({
          data: {
            planId: plan.id,
            planHash: input.planHash,
            recoveryEpoch: runtime.recoveryEpoch,
            previousRuntimeVersion: runtime.version,
            runtimeVersion: runtime.version + (runtimeChanged ? 1 : 0),
            actorId,
            selection: z.record(z.string(), z.json()).parse({
              scope: prepared.scope,
              fileEvidence: stableArchiveFiles(prepared.evidence),
              networkEvidence: stableArchiveNetwork(network),
              bindings,
              reusedBindings,
              policies,
            }),
          },
        });
        await commitArchiveSupersessions(tx, {
          scope: prepared.scope,
          fileEvidence: prepared.evidence,
          networkEvidence: network,
          planId: plan.id,
          receiptId: receipt.id,
          planHash: input.planHash,
        });
        for (const edge of prepared.scope.edges.filter(
          (item) => item.selected,
        )) {
          const descriptor = NativeArchiveContinuationSchema.parse({
            schemaVersion: 1,
            allowedAction: "expire_archive",
            selectedCleanupId: edge.id,
            scope: prepared.scope,
            fileEvidence: prepared.evidence,
            bindings,
            reusedBindings,
          });
          await tx.nativeArchiveCleanupContinuation.create({
            data: {
              receiptId: receipt.id,
              originalCleanupId: edge.id,
              recoveryEpoch: runtime.recoveryEpoch,
              descriptor: z.record(z.string(), z.json()).parse(descriptor),
              descriptorHash: snapshotHash(z.json().parse(descriptor)),
            },
          });
          assertArchiveActive(context.execution);
        }
        await tx.nativeRecoveryPlan.update({
          where: { id: plan.id },
          data: { state: "applied", version: { increment: 1 } },
        });
        for (const media of prepared.scope.media)
          await tx.applicationEvent.create({
            data: {
              actorId,
              mediaId: media.id,
              kind: "native_archive_recovered",
              payload: {
                planId: plan.id,
                receiptId: receipt.id,
                recoveryEpoch: runtime.recoveryEpoch,
                physicalOwnershipOnly: true,
              },
            },
          });
        assertArchiveActive(context.execution);
        assertNativeEvidenceFresh(network);
        return receipt.id;
      });
      assertArchiveActive(context.execution);
      assertNativeEvidenceFresh(network);
      return receiptId;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
