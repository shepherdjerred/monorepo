import type { Database } from "#infrastructure/database.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";

/** Disposable-fixture observation only; production always observes actual controllers. */
export async function grantTestLease(db: Database, epoch = 0): Promise<void> {
  const observedAt = new Date();
  const data = {
    recoveryEpoch: epoch,
    targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    observation: { fixture: true },
    observedAt,
    expiresAt: new Date(observedAt.getTime() + 90_000),
    revokedAt: null,
  };
  await db.legacyWriterLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
}
