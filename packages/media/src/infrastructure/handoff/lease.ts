import type { Database } from "#infrastructure/database.ts";
import {
  QuiescenceEvidenceSchema,
  type QuiescenceEvidence,
} from "#shared/legacy-observer.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { queueOwnerHealth } from "#infrastructure/notifications/owner-health.ts";

/** Only the injected trusted observer produces evidence; no HTTP endpoint accepts it. */
export async function refreshWriterLease(
  db: Database,
  observe: () => Promise<QuiescenceEvidence>,
): Promise<void> {
  const before = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const evidence = QuiescenceEvidenceSchema.parse(await observe());
  const observedAt = new Date(evidence.capturedAt);
  const expiresAt = new Date(evidence.expiresAt);
  const timestamp = Date.now();
  if (
    observedAt.getTime() > timestamp ||
    expiresAt.getTime() <= timestamp ||
    expiresAt.getTime() - observedAt.getTime() > 120_000 ||
    evidence.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
    evidence.targetsDigest !==
      snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments)
  )
    throw new Error("Legacy writer observation invalid");
  const clear =
    evidence.quiescent &&
    evidence.blockers.length === 0 &&
    evidence.controllers.length ===
      LEGACY_OBSERVER_CONFIG.legacyDeployments.length &&
    LEGACY_OBSERVER_CONFIG.legacyDeployments.every((name) =>
      evidence.controllers.some(
        (controller) =>
          controller.name === name &&
          controller.desired === 0 &&
          controller.current === 0 &&
          controller.ready === 0 &&
          controller.observedGeneration >= controller.generation,
      ),
    );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.recoveryEpoch !== before.recoveryEpoch ||
      runtime.version !== before.version
    )
      return;
    const previous = await tx.legacyWriterLease.findUnique({
      where: { id: "singleton" },
    });
    if (previous !== null && previous.observedAt > observedAt) return;
    const data = {
      recoveryEpoch: runtime.recoveryEpoch,
      targetsDigest: evidence.targetsDigest,
      configurationDigest: evidence.configurationDigest,
      observation: evidence,
      observedAt,
      expiresAt,
      revokedAt: clear ? null : new Date(),
    };
    await tx.legacyWriterLease.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: { ...data, version: { increment: 1 } },
    });
    if (!clear && runtime.mode === "active") {
      const revoked = await tx.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: {
          mode: "observe",
          ownershipConfirmed: false,
          version: { increment: 1 },
        },
      });
      await queueOwnerHealth(tx, {
        schemaVersion: 1,
        reason: "legacy_writer_authority_revoked",
        recoveryEpoch: revoked.recoveryEpoch,
        runtimeVersion: revoked.version,
        evidenceDigest: evidence.inventoryDigest,
      });
    }
  });
}
