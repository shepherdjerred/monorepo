import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativeQuarantineNetworkEvidenceSchema,
  NativeQuarantineContinuationSchema,
} from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockNativeQuarantineScope,
  assertNativeQuarantineSnapshot,
} from "#infrastructure/native-quarantine/guards.ts";
import {
  installNativeAuthority,
  assertNativeEvidenceFresh,
  nativeApprovingActor,
} from "#automation/native-recovery/authority.ts";
import { appendNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { PreparedNativeQuarantine } from "./files.ts";
import { withQuarantineLocks } from "./physical.ts";
import { stableQuarantineNetwork, stableQuarantineFiles } from "./plan.ts";
import { rebindQuarantinedSubtitles } from "./subtitles.ts";

export async function applyPreparedQuarantine(
  context: NativeFileContext,
  input: { planId: string; operationId: string },
  prepared: PreparedNativeQuarantine,
) {
  return await context.files.db.$transaction(
    async (tx) => {
      await lockNativeQuarantineScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${input.planId} FOR UPDATE`;
      const previous = await tx.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (previous !== null) return previous.id;
      const { plan, runtime } = await assertNativeQuarantineSnapshot(
        tx,
        input.planId,
        prepared.scope,
      );
      if (
        plan.state !== "applying" ||
        plan.planHash === null ||
        plan.expiresAt === null ||
        plan.expiresAt <= new Date()
      )
        throw new Error("Quarantine owner approval missing or expired");
      const finished = FinishedNativeV2Schema.parse(plan.plan);
      if (
        finished.lifecycleKind !== "committed_quarantine" ||
        snapshotHash(finished) !== plan.planHash ||
        finished.scopeHash !== snapshotHash(prepared.scope) ||
        snapshotHash(finished.files) !==
          snapshotHash(stableQuarantineFiles(prepared.evidence))
      )
        throw new Error("Quarantine reviewed physical identity changed");
      const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId: plan.id, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = NativeQuarantineNetworkEvidenceSchema.parse(
        observation.evidence,
      );
      if (
        network.planId !== plan.id ||
        network.recoveryEpoch !== runtime.recoveryEpoch ||
        observation.expiresAt <= new Date() ||
        observation.evidenceHash !== snapshotHash(network) ||
        snapshotHash(finished.network) !==
          snapshotHash(stableQuarantineNetwork(network))
      )
        throw new Error("Quarantine reviewed network identity changed");
      const actorId = await nativeApprovingActor(
        tx,
        input,
        plan.planHash,
        "apply_native_quarantine",
      );
      const planHash = plan.planHash;
      const receiptId = await withQuarantineLocks(
        context,
        prepared,
        async () => {
          await installNativeAuthority(tx, context, {
            scope: prepared.scope,
            network,
          });
          const bindings = [];
          for (const file of prepared.scope.files) {
            await tx.libraryAsset.update({
              where: { id: file.assetId },
              data: {
                ownershipEpoch: runtime.recoveryEpoch,
                version: { increment: 1 },
              },
            });
            const subtitles = await rebindQuarantinedSubtitles(
              tx,
              file,
              runtime.recoveryEpoch,
              file.assetVersion + 1,
            );
            bindings.push({
              assetId: file.assetId,
              beforeVersion: file.assetVersion,
              assetVersion: file.assetVersion + 1,
              checksum: file.checksum,
              mediaIds: file.mediaIds,
              ownershipEpoch: runtime.recoveryEpoch,
              subtitles,
            });
          }
          const policies = await appendNativeSubtitlePolicies(tx, {
            policies: prepared.scope.subtitlePolicies,
            epoch: runtime.recoveryEpoch,
            actorId,
            planId: plan.id,
          });
          for (const media of prepared.scope.media)
            await tx.recoveryHold.upsert({
              where: targetWhere(defaultScope(media.id)),
              create: {
                mediaId: media.id,
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
          await tx.mediaRuntimeState.update({
            where: { id: "singleton" },
            data: {
              mode: "active",
              ownershipConfirmed: true,
              version: { increment: 1 },
            },
          });
          const receipt = await tx.nativeRecoveryReceipt.create({
            data: {
              planId: plan.id,
              planHash,
              recoveryEpoch: runtime.recoveryEpoch,
              previousRuntimeVersion: runtime.version,
              runtimeVersion: runtime.version + 1,
              actorId,
              selection: {
                scope: prepared.scope,
                fileEvidence: stableQuarantineFiles(prepared.evidence),
                networkEvidence: stableQuarantineNetwork(network),
                bindings,
                policies,
              },
            },
          });
          for (const group of prepared.scope.groups) {
            const descriptor = NativeQuarantineContinuationSchema.parse({
              schemaVersion: 1,
              allowedAction: "restore",
              group,
              files: prepared.scope.files.filter((file) =>
                group.assetIds.includes(file.assetId),
              ),
              participants: prepared.evidence.participants.filter((item) =>
                group.assetIds.includes(item.assetId),
              ),
              bindings: bindings.filter((item) =>
                group.assetIds.includes(item.assetId),
              ),
              journals: prepared.evidence.groupJournals.find(
                (item) => item.groupHash === group.groupHash,
              )?.journals,
            });
            await tx.nativeQuarantineContinuation.create({
              data: {
                receiptId: receipt.id,
                groupHash: group.groupHash,
                recoveryEpoch: runtime.recoveryEpoch,
                descriptor,
              },
            });
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
                kind: "native_quarantine_recovered",
                payload: {
                  planId: plan.id,
                  receiptId: receipt.id,
                  recoveryEpoch: runtime.recoveryEpoch,
                  physicalOwnershipOnly: true,
                },
              },
            });
          assertNativeEvidenceFresh(network);
          return receipt.id;
        },
      );
      // Scope exit validates identities asynchronously; expiry must still hold afterwards.
      assertNativeEvidenceFresh(network);
      return receiptId;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
