import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import {
  NativeRecoveryFileEvidenceSchema,
  NativeRecoveryNetworkEvidenceSchema,
} from "#shared/native-recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
} from "#infrastructure/native-recovery/guards.ts";
import type { PreparedNativeFiles } from "./files.ts";

export function stableNativeNetwork(raw: unknown) {
  const network = NativeRecoveryNetworkEvidenceSchema.parse(raw);
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
export function stableNativeFiles(raw: unknown) {
  const files = NativeRecoveryFileEvidenceSchema.parse(raw);
  return {
    planId: files.planId,
    recoveryEpoch: files.recoveryEpoch,
    workerPodUid: files.workerPodUid,
    files: files.files,
  };
}
export const FinishedNativeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scopeHash: z.string(),
  network: z.json(),
  files: z.json(),
});

export async function finishNativePreparation(
  db: Database,
  planId: string,
  prepared: PreparedNativeFiles,
) {
  await db.$transaction(
    async (tx) => {
      await lockNativeScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${planId} FOR UPDATE`;
      const { plan } = await assertNativeSnapshot(tx, planId, prepared.scope);
      if (plan.state === "awaiting_review") return;
      if (plan.state !== "preparing")
        throw new Error("Native preparation state changed");
      const network = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      if (network.expiresAt <= new Date())
        throw new Error("Native network observation expired during inspection");
      const finished = FinishedNativeSchema.parse({
        schemaVersion: 1,
        scopeHash: snapshotHash(z.json().parse(prepared.scope)),
        network: stableNativeNetwork(network.evidence),
        files: stableNativeFiles(prepared.evidence),
      });
      await tx.nativeRecoveryObservation.create({
        data: {
          planId,
          kind: "files",
          evidenceHash: snapshotHash(z.json().parse(prepared.evidence)),
          evidence: z.record(z.string(), z.json()).parse(prepared.evidence),
          observedAt: new Date(prepared.evidence.capturedAt),
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
        },
      });
      await tx.nativeRecoveryPlan.update({
        where: { id: planId },
        data: {
          state: "awaiting_review",
          plan: finished,
          planHash: snapshotHash(finished),
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
          version: { increment: 1 },
        },
      });
    },
    { timeout: 30_000 },
  );
}
