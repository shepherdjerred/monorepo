import { z } from "zod";
import {
  NativeQuarantineNetworkEvidenceSchema,
  NativeQuarantineFileEvidenceSchema,
} from "#shared/native-recovery/quarantine.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockNativeQuarantineScope,
  assertNativeQuarantineSnapshot,
} from "#infrastructure/native-quarantine/guards.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { PreparedNativeQuarantine } from "./files.ts";
import { withQuarantineLocks } from "./physical.ts";

export function stableQuarantineNetwork(raw: unknown) {
  const network = NativeQuarantineNetworkEvidenceSchema.parse(raw);
  return {
    planId: network.planId,
    recoveryEpoch: network.recoveryEpoch,
    configurationDigest: network.mounts.configurationDigest,
    targetsDigest: network.quiescence.targetsDigest,
    controllers: network.quiescence.controllers,
    mounts: network.mounts.mounts,
    plex: network.plex,
    torrents: network.torrents,
  };
}
export function stableQuarantineFiles(raw: unknown) {
  const { capturedAt: _capturedAt, ...stable } =
    NativeQuarantineFileEvidenceSchema.parse(raw);
  return stable;
}

export async function finishQuarantinePreparation(
  context: NativeFileContext,
  input: { planId: string; operationId: string },
  prepared: PreparedNativeQuarantine,
) {
  await context.files.db.$transaction(
    async (tx) => {
      await lockNativeQuarantineScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${input.planId} FOR UPDATE`;
      const { plan } = await assertNativeQuarantineSnapshot(
        tx,
        input.planId,
        prepared.scope,
      );
      if (plan.state === "awaiting_review") return;
      if (plan.state !== "preparing")
        throw new Error("Quarantine preparation state changed");
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const command = z
        .object({ planId: z.uuid(), recoveryEpoch: z.int() })
        .parse(operation.payload);
      if (
        operation.kind !== "prepare_native_quarantine" ||
        operation.targetId !== plan.id ||
        operation.userId !== plan.actorId ||
        command.planId !== plan.id ||
        command.recoveryEpoch !== plan.recoveryEpoch
      )
        throw new Error("Quarantine preparation command authority changed");
      await assertNativeOwner(tx, plan.actorId);
      const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId: plan.id, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = NativeQuarantineNetworkEvidenceSchema.parse(
        observation.evidence,
      );
      if (
        observation.expiresAt <= new Date() ||
        observation.evidenceHash !== snapshotHash(network) ||
        network.planId !== plan.id ||
        network.recoveryEpoch !== plan.recoveryEpoch
      )
        throw new Error("Quarantine network observation changed");
      await withQuarantineLocks(context, prepared, async () => {
        assertNativeEvidenceFresh(network);
        const finished = FinishedNativeV2Schema.parse({
          schemaVersion: 2,
          lifecycleKind: "committed_quarantine",
          scopeHash: snapshotHash(prepared.scope),
          network: stableQuarantineNetwork(network),
          files: stableQuarantineFiles(prepared.evidence),
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
        assertNativeEvidenceFresh(network);
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
