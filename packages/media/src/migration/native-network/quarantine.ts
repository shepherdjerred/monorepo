import { z } from "zod";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexClient } from "#integrations/plex.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineNetworkEvidenceSchema,
} from "#shared/native-recovery/quarantine.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  assertNativeQuarantineSnapshot,
  lockNativeQuarantineScope,
} from "#infrastructure/native-quarantine/guards.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { NativeRecoveryObserverContext } from "./producer.ts";
import { assertCanonicalIdentity, assertWritersQuiescent } from "./evidence.ts";
import { observeNativeTorrents } from "./torrents.ts";
import { observeQuarantinePlex } from "./quarantine-plex.ts";

export type NativeQuarantineObserverContext = Omit<
  NativeRecoveryObserverContext,
  "plex"
> & {
  plex: NativeRecoveryObserverContext["plex"] &
    Pick<PlexClient, "activeSessions">;
};

export function createNativeQuarantineObserver(
  context: NativeQuarantineObserverContext,
) {
  return async (
    planId: string,
    budget = new PublicationAuthorityReadBudget(),
  ) => {
    const signal = AbortSignal.timeout(60_000);
    const capturedAt = new Date();
    const plan = await context.db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: planId },
    });
    const scope = NativeQuarantineScopeSchema.parse(plan.scope);
    await assertNativeQuarantineSnapshot(context.db, planId, scope, budget);
    const roots = await assertNativeStorageRoots(
      context.db,
      scope.storageRoots,
      budget,
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
      observeQuarantinePlex(context, scope, signal),
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
    const evidence = NativeQuarantineNetworkEvidenceSchema.parse({
      schemaVersion: 2,
      lifecycleKind: "committed_quarantine",
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
      await lockNativeQuarantineScope(tx, scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${planId} FOR SHARE`;
      const current = await assertNativeQuarantineSnapshot(
        tx,
        planId,
        scope,
        budget,
      );
      if (
        !["preparing", "awaiting_review", "applying"].includes(
          current.plan.state,
        ) ||
        expiresAt.getTime() <= Date.now()
      )
        throw new Error(
          "Native quarantine observation is no longer applicable",
        );
      assertWritersQuiescent(quiescence);
      assertCanonicalIdentity(
        mounts,
        await assertNativeStorageRoots(tx, scope.storageRoots, budget),
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
