import { vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type {
  QuiescenceEvidence,
  MountEvidence,
} from "#shared/legacy-observer.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";

export function healthHarness() {
  const harness = automationTestHarness();
  async function setup(revoke = true) {
    const db = harness.database();
    await db.mediaUser.updateMany({
      where: { role: "owner" },
      data: { role: "member" },
    });
    const fixture = await harness.fixture();
    const user = await db.mediaUser.update({
      where: { id: fixture.user.id },
      data: {
        role: "owner",
        email: "owner@example.test",
        emailVerifiedAt: new Date(),
        notificationPreference: { create: { emailEnabled: true } },
      },
    });
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { version: { increment: 1 } },
    });
    if (revoke)
      await refreshWriterLease(db, () =>
        Promise.resolve(writerObservation(false)),
      );
    const ctx = harness.context();
    const notify = vi.fn(() =>
      Promise.resolve({ receipt: "fixture-health-receipt" }),
    );
    ctx.notify = notify;
    const service = new PrismaNotificationApplication(
      db,
      harness.cipher,
      null,
      { publicOrigin: ctx.publicOrigin },
    );
    return { ...fixture, user, db, ctx, notify, service };
  }
  async function delivery(userId: string) {
    return harness.database().notificationDelivery.findFirstOrThrow({
      where: { userId, event: { kind: "owner_health" } },
      orderBy: { createdAt: "desc" },
      include: { event: true },
    });
  }
  return { ...harness, setup, delivery };
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

export function mountObservation(): MountEvidence {
  return {
    schemaVersion: 1,
    namespace: "media",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    bindings: ["movies", "tv"].map((kind) => {
      const source = {
        deployment: kind === "movies" ? "media-radarr" : "media-sonarr",
        deploymentUid: kind === "movies" ? "media-radarr" : "media-sonarr",
        generation: 1,
        specDigest: "b".repeat(64),
        container: "source",
        root: `/${kind}`,
        mountPath: `/${kind}`,
        subPath: "",
        readOnly: false,
        pvcName: kind,
        pvcUid: `pvc-${kind}`,
        volumeName: `pv-${kind}`,
        volumePath: ".",
      };
      return {
        source,
        canonical: {
          ...source,
          deployment: "media-media-files",
          deploymentUid: "files",
          container: "media-files",
          root: `/data/${kind}`,
          mountPath: `/data/${kind}`,
          podName: "files-pod",
          podUid: "files-pod",
          podSpecDigest: "c".repeat(64),
          replicaSetUid: "files-set",
        },
        evidenceHash: "d".repeat(64),
      };
    }),
  };
}
