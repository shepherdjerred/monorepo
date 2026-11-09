import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import type { Database } from "#infrastructure/database.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";

/** Exact scoped identity for disposable command fixtures; never a production bypass. */
export async function grantTestRequesterAccess(
  db: Database,
  userId: string,
  serverMachineId: string,
) {
  const user = await db.mediaUser.findUniqueOrThrow({ where: { id: userId } });
  const data = {
    serverMachineId,
    serverAccountId: user.plexAccountId,
    kind: "account",
    permittedSectionIds: ["1", "2"],
    permittedMediaKinds: ["movie", "series"],
    plexRestricted: false,
    verifiedAt: new Date(),
  };
  await db.plexIdentityMapping.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

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

export function writerObservation(quiescent: boolean): QuiescenceEvidence {
  return {
    schemaVersion: 1,
    namespace: "media",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
    inventoryDigest: "a".repeat(64),
    quiescent,
    blockers: quiescent
      ? []
      : [{ code: "writer_running", kind: "Deployment", name: "media-radarr" }],
    controllers: LEGACY_OBSERVER_CONFIG.legacyDeployments.map((name) => ({
      kind: "Deployment",
      name,
      uid: name,
      generation: 1,
      resourceVersion: "1",
      specDigest: "b".repeat(64),
      observedGeneration: 1,
      desired: quiescent ? 0 : 1,
      current: quiescent ? 0 : 1,
      ready: quiescent ? 0 : 1,
    })),
  };
}
