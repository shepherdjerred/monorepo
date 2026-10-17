import { z } from "zod";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import { NativePublishedScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
} from "#infrastructure/native-recovery/guards.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { HandoffNetworkContext } from "#migration/handoff-network/context.ts";
import { observePlex } from "#migration/handoff-network/plex.ts";
import { observeNativeTorrents } from "./torrents.ts";
import { assertCanonicalIdentity, assertWritersQuiescent } from "./evidence.ts";

export type NativeRecoveryObserverContext = Pick<
  HandoffNetworkContext,
  | "db"
  | "plex"
  | "qbittorrent"
  | "observer"
  | "permittedSections"
  | "expectedServerMachineId"
>;

/** Consumes only stored reviewed scope; external APIs are GET-only and writes are immutable observations. */
export function createNativeRecoveryObserver(
  context: NativeRecoveryObserverContext,
) {
  return async (planId: string) => {
    const signal = AbortSignal.timeout(60_000);
    const capturedAt = new Date();
    const plan = await context.db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: planId },
    });
    const scope = NativePublishedScopeSchema.parse(plan.scope);
    await assertNativeSnapshot(context.db, planId, scope);
    const roots = await assertNativeStorageRoots(
      context.db,
      scope.storageRoots,
    );
    const quiescence = QuiescenceEvidenceSchema.parse(
      await context.observer.observe(signal),
    );
    assertWritersQuiescent(quiescence);
    const mounts = CanonicalMountEvidenceSchema.parse(
      await context.observer.observeCanonicalMounts(signal),
    );
    assertCanonicalIdentity(mounts, roots);
    const [plex, torrents] = await Promise.all([
      observePlex(
        context,
        { media: scope.media, scope: { files: scope.files } },
        signal,
      ),
      observeNativeTorrents({
        torrents: scope.torrents,
        qbittorrent: context.qbittorrent,
        signal,
      }),
    ]);
    signal.throwIfAborted();
    const expiresAt = new Date(
      Math.min(
        Date.parse(quiescence.expiresAt),
        Date.parse(mounts.expiresAt),
        capturedAt.getTime() + 90_000,
      ),
    );
    const evidence = NativeRecoveryNetworkEvidenceSchema.parse({
      schemaVersion: 1,
      planId,
      recoveryEpoch: plan.recoveryEpoch,
      capturedAt: capturedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      quiescence,
      mounts,
      plex,
      torrents,
    });
    const serialized = z.record(z.string(), z.json()).parse(evidence);
    const evidenceHash = snapshotHash(serialized);
    return context.db.$transaction(async (tx) => {
      await lockNativeScope(tx, scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${planId} FOR SHARE`;
      const current = await assertNativeSnapshot(tx, planId, scope);
      if (
        !["preparing", "awaiting_review", "applying"].includes(
          current.plan.state,
        ) ||
        expiresAt.getTime() <= Date.now()
      )
        throw new Error("Native recovery observation is no longer applicable");
      assertWritersQuiescent(quiescence);
      assertCanonicalIdentity(
        mounts,
        await assertNativeStorageRoots(tx, scope.storageRoots),
      );
      const observation = await tx.nativeRecoveryObservation.create({
        data: {
          planId,
          kind: "network",
          evidenceHash,
          evidence: serialized,
          observedAt: capturedAt,
          expiresAt,
        },
      });
      return {
        observationId: observation.id,
        evidenceHash,
        expiresAt: expiresAt.toISOString(),
      };
    });
  };
}
