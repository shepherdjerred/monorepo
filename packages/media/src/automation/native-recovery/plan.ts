import { z } from "zod";
import { finishNativePlexPlan } from "#infrastructure/plex-binding/native/native-version.ts";
import { FinishedNativePlexV3Schema } from "#shared/plex-binding/native-version.ts";
import { PublishedPlexStableFilesSchema } from "#shared/plex-binding/native-projections.ts";
import { assertNativeFilesProof } from "./plex-proof.ts";
import type { Database } from "#infrastructure/database.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import {
  NativePublishedFileEvidenceSchema,
  FinishedNativeV2Schema,
} from "#shared/native-recovery/lifecycle.ts";
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
  const files = NativePublishedFileEvidenceSchema.parse(raw);
  return {
    ...(files.schemaVersion === 1
      ? {}
      : {
          schemaVersion: 2,
          lifecycleKind: "published",
          terminalEvidence: files.terminalEvidence,
          ...(files.settledEvidence === undefined
            ? {}
            : { settledEvidence: files.settledEvidence }),
          ...(files.compensationEvidence === undefined
            ? {}
            : { compensationEvidence: files.compensationEvidence }),
        }),
    planId: files.planId,
    recoveryEpoch: files.recoveryEpoch,
    workerPodUid: files.workerPodUid,
    files: files.files,
  };
}
export const FinishedNativeSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    scopeHash: z.string(),
    network: z.json(),
    files: z.json(),
  }),
  FinishedNativeV2Schema,
  FinishedNativePlexV3Schema,
]);

export async function finishNativePreparation(
  db: Database,
  planId: string,
  prepared: PreparedNativeFiles,
) {
  await db.$transaction(
    async (tx) => {
      await lockNativeScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${planId} FOR UPDATE`;
      const { plan } = await assertNativeSnapshot(
        tx,
        planId,
        prepared.scope,
        prepared.plex.budget,
      );
      if (plan.state === "awaiting_review") return;
      if (plan.state !== "preparing")
        throw new Error("Native preparation state changed");
      if (prepared.plex.kind !== "paired")
        throw new Error(
          "New native preparation requires its paired Plex proof",
        );
      await assertNativeFilesProof(tx, prepared.plex);
      const finished = await finishNativePlexPlan(
        tx,
        {
          planId,
          plex: prepared.plex.ref,
          files: PublishedPlexStableFilesSchema.parse(
            stableNativeFiles(prepared.evidence),
          ),
        },
        prepared.plex.freshness,
        prepared.plex.budget,
      );
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
          plan: z.record(z.string(), z.json()).parse(finished),
          planHash: snapshotHash(z.json().parse(finished)),
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
          version: { increment: 1 },
        },
      });
      prepared.plex.freshness.assertActive();
    },
    { timeout: 30_000 },
  );
}
