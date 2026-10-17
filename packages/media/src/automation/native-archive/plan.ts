import { z } from "zod";
import { NativeArchiveNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
import {
  stableArchiveFiles,
  stableArchiveNetwork,
} from "#infrastructure/native-archive/plan.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import type { PreparedNativeArchive } from "./files.ts";
import { withArchiveLocks } from "./physical.ts";

export async function finishArchivePreparation(
  context: ArchiveFileContext,
  input: { planId: string; operationId: string },
  prepared: PreparedNativeArchive,
) {
  assertArchiveActive(context.execution);
  await context.files.db.$transaction(
    async (tx) => {
      await lockNativeArchiveScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${input.planId} FOR UPDATE`;
      assertArchiveActive(context.execution);
      const { plan } = await assertNativeArchiveSnapshot(
        tx,
        input.planId,
        prepared.scope,
      );
      if (plan.state === "awaiting_review") return;
      if (plan.state !== "preparing")
        throw new Error("Archive preparation state changed");
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const payload = z
        .object({ planId: z.uuid(), recoveryEpoch: z.int() })
        .parse(operation.payload);
      if (
        operation.kind !== "prepare_native_archive" ||
        operation.targetId !== plan.id ||
        operation.userId !== plan.actorId ||
        payload.planId !== plan.id ||
        payload.recoveryEpoch !== plan.recoveryEpoch
      )
        throw new Error("Archive preparation operation changed");
      await assertNativeOwner(tx, plan.actorId);
      const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId: plan.id, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = NativeArchiveNetworkEvidenceSchema.parse(
        observation.evidence,
      );
      if (
        observation.expiresAt <= new Date() ||
        observation.evidenceHash !== snapshotHash(network) ||
        network.planId !== plan.id ||
        network.recoveryEpoch !== plan.recoveryEpoch
      )
        throw new Error("Archive network evidence changed");
      await withArchiveLocks(context, prepared, async () => {
        assertNativeEvidenceFresh(network);
        const finished = FinishedNativeV2Schema.parse({
          schemaVersion: 2,
          lifecycleKind: "superseded_archive",
          scopeHash: snapshotHash(z.json().parse(prepared.scope)),
          network: stableArchiveNetwork(network),
          files: stableArchiveFiles(prepared.evidence),
        });
        await tx.nativeRecoveryObservation.create({
          data: {
            planId: plan.id,
            kind: "files",
            evidenceHash: snapshotHash(prepared.evidence),
            evidence: prepared.evidence,
            observedAt: new Date(prepared.evidence.capturedAt),
            expiresAt: new Date(Date.now() + 12 * 3_600_000),
          },
        });
        assertArchiveActive(context.execution);
        await tx.nativeRecoveryPlan.update({
          where: { id: plan.id },
          data: {
            state: "awaiting_review",
            plan: finished,
            planHash: snapshotHash(finished),
            expiresAt: new Date(Date.now() + 12 * 3_600_000),
            version: { increment: 1 },
          },
        });
        assertArchiveActive(context.execution);
        assertNativeEvidenceFresh(network);
      });
      assertArchiveActive(context.execution);
      assertNativeEvidenceFresh(network);
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
