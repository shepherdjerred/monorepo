import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  NativeRecoveryNetworkEvidenceSchema,
  NativeRecoveryScope,
} from "#shared/native-recovery.ts";
import { NativeStorageAuthoritySchema } from "#shared/canonical-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import type { NativeFileContext } from "./files.ts";

export function assertNativeEvidenceFresh(
  network: Pick<
    z.infer<typeof NativeRecoveryNetworkEvidenceSchema>,
    "capturedAt" | "expiresAt" | "quiescence" | "mounts"
  >,
): void {
  const now = Date.now();
  for (const evidence of [network, network.quiescence, network.mounts]) {
    const captured = Date.parse(evidence.capturedAt);
    const expires = Date.parse(evidence.expiresAt);
    if (
      captured > now ||
      expires <= now ||
      expires <= captured ||
      expires - captured > 120_000
    )
      throw new Error(
        "Native recovery authority expired or has invalid freshness",
      );
  }
}

export async function nativeApprovingActor(
  tx: Prisma.TransactionClient,
  input: { planId: string; operationId: string },
  planHash: string,
  expectedKind:
    | "apply_native_recovery"
    | "apply_native_quarantine"
    | "apply_native_archive" = "apply_native_recovery",
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const payload = z
    .object({
      actorId: z.uuid(),
      planId: z.uuid(),
      planHash: z.string(),
      recoveryEpoch: z.int(),
    })
    .parse(operation.payload);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    operation.kind !== expectedKind ||
    operation.targetId !== input.planId ||
    payload.planId !== input.planId ||
    operation.userId !== payload.actorId ||
    payload.planHash !== planHash ||
    payload.recoveryEpoch !== runtime.recoveryEpoch
  )
    throw new Error("Native recovery approval operation changed");
  await assertNativeOwner(tx, payload.actorId);
  return payload.actorId;
}

export async function installNativeAuthority(
  tx: Prisma.TransactionClient,
  context: NativeFileContext,
  input: {
    scope: Pick<NativeRecoveryScope, "storageRoots">;
    network: Pick<
      z.infer<typeof NativeRecoveryNetworkEvidenceSchema>,
      "capturedAt" | "expiresAt" | "quiescence" | "mounts" | "recoveryEpoch"
    >;
  },
) {
  const { network, scope } = input;
  assertNativeEvidenceFresh(network);
  const evidence = network.quiescence;
  assertNativeWriters(evidence);
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR UPDATE`;
  const lease = await tx.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  if (
    lease !== null &&
    lease.recoveryEpoch === network.recoveryEpoch &&
    lease.revokedAt !== null &&
    lease.observedAt.getTime() >= Date.parse(evidence.capturedAt)
  )
    throw new Error("Native writer observation superseded by revocation");
  if (network.mounts.configurationDigest !== evidence.configurationDigest)
    throw new Error("Native storage observation is stale");
  const storedEvidence = NativeStorageAuthoritySchema.parse({
    schemaVersion: 1,
    kind: "native_restore",
    approvedRoots: scope.storageRoots,
    mounts: network.mounts,
  });
  for (const root of scope.storageRoots) {
    const mount = network.mounts.mounts.find(
      (item) => item.root === root.rootPath,
    );
    if (
      mount?.podUid !== context.workerPodUid ||
      mount.pvcUid !== root.pvcUid ||
      mount.volumeName !== root.volumeName ||
      mount.volumePath !== root.volumePath
    )
      throw new Error("Native storage identity changed after prior approval");
    const previous = await tx.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: root.rootPath },
    });
    if (
      previous.recoveryEpoch === network.recoveryEpoch &&
      previous.revokedAt !== null &&
      previous.observedAt.getTime() >= Date.parse(network.mounts.capturedAt)
    )
      throw new Error("Native storage evidence superseded by revocation");
    const kind = root.rootPath === "/data/movies" ? "movies" : "tv";
    if (context.files.verifyPlexExclusion === undefined)
      throw new Error("Native exclusion proof unavailable");
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    await tx.mediaStorageAuthority.update({
      where: { rootPath: root.rootPath },
      data: {
        recoveryEpoch: network.recoveryEpoch,
        workerPodUid: context.workerPodUid,
        evidence: storedEvidence,
        observedAt: new Date(network.mounts.capturedAt),
        expiresAt: new Date(network.mounts.expiresAt),
        revokedAt: null,
        version: { increment: 1 },
      },
    });
  }
  const data = {
    recoveryEpoch: network.recoveryEpoch,
    targetsDigest: evidence.targetsDigest,
    configurationDigest: evidence.configurationDigest,
    observation: evidence,
    observedAt: new Date(evidence.capturedAt),
    expiresAt: new Date(evidence.expiresAt),
  };
  await tx.legacyWriterLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: { ...data, revokedAt: null, version: { increment: 1 } },
  });
}

function assertNativeWriters(
  evidence: z.infer<typeof NativeRecoveryNetworkEvidenceSchema>["quiescence"],
) {
  if (
    !evidence.quiescent ||
    evidence.blockers.length > 0 ||
    evidence.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
    evidence.targetsDigest !==
      snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments)
  )
    throw new Error("Native writer quiescence is not current");
}
