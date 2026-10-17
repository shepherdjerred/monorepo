import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { createLegacyObserver } from "#integrations/legacy-observer/runtime.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import {
  MountEvidenceSchema,
  QuiescenceEvidenceSchema,
  type MountBindingRequest,
} from "#shared/legacy-observer.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOwnerHealth } from "#infrastructure/notifications/owner-health.ts";

/** Refresh may move to a new executing Pod, but never to a new storage identity. */
export async function refreshStorageAuthorities(
  db: Database,
  observer: ReturnType<typeof createLegacyObserver>,
): Promise<void> {
  const before = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (before.mode !== "active" || !before.ownershipConfirmed) return;
  const rows = await db.mediaStorageAuthority.findMany({
    where: { recoveryEpoch: before.recoveryEpoch },
    orderBy: { rootPath: "asc" },
  });
  let observation: ReturnType<typeof MountEvidenceSchema.parse> | null = null;
  try {
    const bindings: MountBindingRequest[] = rows.map((row) => {
      const stored = MountEvidenceSchema.parse(row.evidence);
      const matching = stored.bindings.filter(
        (binding) => binding.canonical.root === row.rootPath,
      );
      const binding = matching[0];
      if (!binding || matching.length !== 1 || row.revokedAt !== null)
        throw new Error("Storage binding missing or revoked");
      return {
        sourceDeployment: binding.source.deployment,
        sourceContainer: binding.source.container,
        sourceRoot: binding.source.root,
        canonicalDeployment: binding.canonical.deployment,
        canonicalContainer: binding.canonical.container,
        canonicalRoot: binding.canonical.root,
      };
    });
    if (
      bindings.length !== 2 ||
      !bindings.some((binding) => binding.canonicalRoot === "/data/movies") ||
      !bindings.some((binding) => binding.canonicalRoot === "/data/tv")
    )
      throw new Error("Storage root coverage incomplete");
    observation = MountEvidenceSchema.parse(
      await observer.observeMountBindings(bindings),
    );
  } catch {
    // Any unreadable or ambiguous proof revokes authority; no raw external errors persist.
  }
  const observedAt =
    observation === null ? new Date() : new Date(observation.capturedAt);
  const expiresAt =
    observation === null ? observedAt : new Date(observation.expiresAt);
  const wire = JSON.stringify(observation);
  const serialized =
    observation === null
      ? {}
      : z.record(z.string(), z.json()).parse(JSON.parse(wire));
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.version !== before.version ||
      runtime.recoveryEpoch !== before.recoveryEpoch
    )
      return;
    const current = await tx.mediaStorageAuthority.findMany({
      where: { recoveryEpoch: runtime.recoveryEpoch },
      orderBy: { rootPath: "asc" },
    });
    if (
      snapshotHash(
        current.map((row) => ({ root: row.rootPath, version: row.version })),
      ) !==
      snapshotHash(
        rows.map((row) => ({ root: row.rootPath, version: row.version })),
      )
    )
      return;
    const lease = await tx.legacyWriterLease.findUnique({
      where: { id: "singleton" },
    });
    const leaseProof = QuiescenceEvidenceSchema.safeParse(lease?.observation);
    const sourceCurrent =
      lease?.revokedAt === null &&
      lease.recoveryEpoch === runtime.recoveryEpoch &&
      lease.expiresAt.getTime() > Date.now() &&
      leaseProof.success &&
      observation?.bindings.every((binding) =>
        leaseProof.data.controllers.some(
          (controller) =>
            controller.name === binding.source.deployment &&
            controller.uid === binding.source.deploymentUid &&
            controller.generation === binding.source.generation &&
            controller.specDigest === binding.source.specDigest,
        ),
      ) === true;
    const unchanged =
      sourceCurrent &&
      observation !== null &&
      fresh(observation) &&
      rows.every((row) => {
        const mounts = observation.bindings.filter(
          (binding) => binding.canonical.root === row.rootPath,
        );
        const mount = mounts[0]?.canonical;
        return (
          mounts.length === 1 &&
          approvedSourceUnchanged(row, observation) &&
          mount?.pvcUid === row.pvcUid &&
          mount.volumeName === row.volumeName &&
          mount.volumePath === row.volumePath &&
          row.revokedAt === null
        );
      });
    if (!unchanged) {
      await tx.mediaStorageAuthority.updateMany({
        where: { recoveryEpoch: runtime.recoveryEpoch },
        data: { revokedAt: new Date(), version: { increment: 1 } },
      });
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
        reason: "media_storage_authority_revoked",
        recoveryEpoch: revoked.recoveryEpoch,
        runtimeVersion: revoked.version,
        evidenceDigest: snapshotHash(serialized),
      });
      return;
    }
    for (const row of rows) {
      const mount = observation?.bindings.find(
        (binding) => binding.canonical.root === row.rootPath,
      )?.canonical;
      if (!mount) throw new Error("Validated mount disappeared");
      if (row.observedAt > observedAt) continue;
      await tx.mediaStorageAuthority.update({
        where: { rootPath: row.rootPath },
        data: {
          workerPodUid: mount.podUid,
          evidence: serialized,
          observedAt,
          expiresAt,
          version: { increment: 1 },
        },
      });
    }
  });
}

function approvedSourceUnchanged(
  row: { rootPath: string; evidence: unknown },
  observation: ReturnType<typeof MountEvidenceSchema.parse>,
) {
  const prior = MountEvidenceSchema.safeParse(row.evidence);
  if (
    !prior.success ||
    prior.data.configurationDigest !== observation.configurationDigest
  )
    return false;
  const approved = prior.data.bindings.filter(
    (binding) => binding.canonical.root === row.rootPath,
  );
  const current = observation.bindings.filter(
    (binding) => binding.canonical.root === row.rootPath,
  );
  const before = approved[0];
  const after = current[0];
  if (!before || !after || approved.length !== 1 || current.length !== 1)
    return false;
  // Source identity includes the exact controller generation/spec and the full
  // source root/container/PVC/subpath binding. A newer lease cannot approve drift.
  return (
    snapshotHash(z.json().parse(before.source)) ===
    snapshotHash(z.json().parse(after.source))
  );
}

function fresh(observation: ReturnType<typeof MountEvidenceSchema.parse>) {
  const now = Date.now();
  const start = Date.parse(observation.capturedAt);
  const end = Date.parse(observation.expiresAt);
  return (
    start <= now &&
    end > now &&
    end - start <= 120_000 &&
    observation.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG)
  );
}
