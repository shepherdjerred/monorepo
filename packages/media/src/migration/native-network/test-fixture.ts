import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { canonicalFixture } from "#integrations/legacy-observer/canonical-fixture.ts";
import { observeCanonicalMounts } from "#integrations/legacy-observer/canonical-mounts.ts";
import { networkFixture } from "#migration/handoff-network/test-fixture.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { buildNativeScope } from "#infrastructure/native-recovery/scope.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";

export async function nativeNetworkFixture(
  db: Database,
  cipher: CredentialCipher,
  serverMachineId = "server",
) {
  const legacy = await networkFixture(db, cipher, serverMachineId);
  const source = canonicalFixture();
  const canonical = await observeCanonicalMounts({
    request: source.request,
    signal: AbortSignal.timeout(5000),
    now: Date.now,
  });
  const mounts = await legacy.context.observer.observeMountBindings(
    ["movies", "tv"].map((kind) => ({
      sourceDeployment: kind === "movies" ? "media-radarr" : "media-sonarr",
      sourceContainer: "main",
      sourceRoot: `/${kind}`,
      canonicalDeployment: "media-media-files",
      canonicalContainer: "media-files",
      canonicalRoot: `/data/${kind}`,
    })),
  );
  for (const binding of mounts.bindings) {
    const mount = canonical.mounts.find(
      (item) => item.root === binding.canonical.root,
    );
    if (mount === undefined) throw new Error("Fixture root missing");
    binding.canonical = mount;
    binding.source.pvcUid = mount.pvcUid;
    binding.source.volumeName = mount.volumeName;
    binding.source.volumePath = mount.volumePath;
  }
  const network = {
    mounts: mounts.bindings,
    configurationDigest: mounts.configurationDigest,
  };
  const finished = {
    schemaVersion: 1,
    scopeHash: snapshotHash(z.json().parse(legacy.plan.scope)),
    network,
    files: [],
  };
  const planHash = snapshotHash(z.json().parse(finished));
  await db.mediaHandoffPlan.update({
    where: { id: legacy.plan.id },
    data: { state: "applied", plan: finished, planHash },
  });
  const receipt = await db.mediaHandoffReceipt.create({
    data: {
      planId: legacy.plan.id,
      planHash,
      recoveryEpoch: 0,
      previousRuntimeVersion: 0,
      runtimeVersion: 1,
      selection: { networkEvidence: network },
      actorId: legacy.actor.id,
    },
  });
  await db.mediaStorageAuthority.deleteMany();
  for (const mount of canonical.mounts)
    await db.mediaStorageAuthority.create({
      data: {
        rootPath: mount.root,
        recoveryEpoch: 0,
        pvcUid: mount.pvcUid,
        volumeName: mount.volumeName,
        volumePath: mount.volumePath,
        workerPodUid: mount.podUid,
        evidence: mounts,
        observedAt: new Date(mounts.capturedAt),
        expiresAt: new Date(mounts.expiresAt),
      },
    });
  const roots = await resolveNativeStorageRoots(db);
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(legacy.media.id)], {
      createMissing: true,
    });
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/data/movies/${legacy.media.id}/Film.mkv`,
      editionRootId: legacy.media.id,
      checksum: "a".repeat(64),
      sizeBytes: 100n,
      properties: {},
      state: "published",
      owned: true,
      ownershipEpoch: 0,
      coverage: { create: { mediaId: legacy.media.id, current: true } },
    },
  });
  const originalMetadata = legacy.context.plex.metadata;
  legacy.context.plex.metadata = async (...args) => ({
    ...(await originalMetadata(...args)),
    Media: [{ Part: [{ id: 1, file: asset.path, size: 100 }] }],
  });
  const originalPage = legacy.context.plex.libraryPage;
  legacy.context.plex.libraryPage = async (...args) => {
    const page = await originalPage(...args);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        Media: [{ Part: [{ id: 1, file: asset.path, size: 100 }] }],
      })),
    };
  };
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 0,
    reason: "Synthetic recovery fixture",
  });
  const operation = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await grantTestExclusionProofs(db, legacy.actor.id, serverMachineId);
  const scope = await buildNativeScope(db, {
    restoreOperationId: operation.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: "activate",
    assetIds: [asset.id],
  });
  const plan = await db.nativeRecoveryPlan.create({
    data: {
      restoreOperationId: operation.id,
      actorId: legacy.actor.id,
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      scope,
      requestHash: snapshotHash(scope.request),
    },
  });
  legacy.quiescence.targetsDigest = snapshotHash(
    LEGACY_OBSERVER_CONFIG.legacyDeployments,
  );
  legacy.context.observer.observeCanonicalMounts = () =>
    Promise.resolve(canonical);
  return {
    ...legacy,
    source,
    canonical,
    roots,
    asset,
    receipt,
    nativePlan: plan,
    scope,
  };
}

export async function activateNativeFixture(
  f: Awaited<ReturnType<typeof nativeNetworkFixture>>,
) {
  const db = f.context.db;
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const lease = {
    recoveryEpoch: runtime.recoveryEpoch,
    targetsDigest: f.quiescence.targetsDigest,
    configurationDigest: f.quiescence.configurationDigest,
    observation: f.quiescence,
    observedAt: new Date(f.quiescence.capturedAt),
    expiresAt: new Date(f.quiescence.expiresAt),
    revokedAt: null,
  };
  await db.legacyWriterLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...lease },
    update: lease,
  });
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  await db.mediaStorageAuthority.updateMany({
    data: {
      recoveryEpoch: runtime.recoveryEpoch,
      evidence: {
        schemaVersion: 1,
        kind: "native_restore",
        approvedRoots: f.roots,
        mounts: f.canonical,
      },
    },
  });
}
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
