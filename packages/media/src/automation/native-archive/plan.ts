import { z } from "zod";
import { NativeArchiveNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { finishNativePlexPlan } from "#infrastructure/plex-binding/native/native-version.ts";
import { assertNativeFilesProof } from "#automation/native-recovery/plex-proof.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
import { stableArchiveFiles } from "#infrastructure/native-archive/plan.ts";
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
        prepared.plex.budget,
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
      if (prepared.plex.kind !== "paired")
        throw new Error(
          "New archive preparation requires its paired Plex proof",
        );
      const plex = prepared.plex;
      await assertNativeFilesProof(tx, plex);
      const network = NativeArchiveNetworkEvidenceSchema.parse(plex.network);
      if (
        Date.parse(network.expiresAt) <= Date.now() ||
        network.planId !== plan.id ||
        network.recoveryEpoch !== plan.recoveryEpoch
      )
        throw new Error("Archive network evidence changed");
      await withArchiveLocks(context, prepared, async () => {
        assertNativeEvidenceFresh(network);
        const finished = await finishNativePlexPlan(
          tx,
          {
            planId: plan.id,
            plex: plex.ref,
            files: stableArchiveFiles(prepared.evidence),
          },
          plex.freshness,
          plex.budget,
        );
        await tx.nativeRecoveryObservation.create({
          data: {
            planId: plan.id,
            kind: "files",
            evidenceHash: snapshotHash(z.json().parse(prepared.evidence)),
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
            plan: z.record(z.string(), z.json()).parse(finished),
            planHash: snapshotHash(z.json().parse(finished)),
            expiresAt: new Date(Date.now() + 12 * 3_600_000),
            version: { increment: 1 },
          },
        });
        assertArchiveActive(context.execution);
        assertNativeEvidenceFresh(network);
        plex.freshness.assertActive();
      });
      assertArchiveActive(context.execution);
      assertNativeEvidenceFresh(network);
      plex.freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
