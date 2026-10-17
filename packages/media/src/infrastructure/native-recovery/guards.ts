import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { lockMedia } from "#infrastructure/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { lockNativeSubtitleRows } from "#automation/native-subtitles/snapshot.ts";
import {
  NativeRecoveryScopeSchema,
  type NativeRecoveryScope,
} from "#shared/native-recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { buildNativeScope } from "./scope.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";

export async function assertNativeExclusion(tx: Prisma.TransactionClient) {
  for (const library of ["/data/movies", "/data/tv"]) {
    await requirePlexExclusionDatabaseProof(tx, {
      library,
      control: `${library}/.media-control`,
    });
  }
}

export async function lockNativeScope(
  tx: Prisma.TransactionClient,
  scope: NativeRecoveryScope,
) {
  const ids = scope.media.map((row) => row.id);
  await lockMedia(tx, ids);
  await lockEffectiveRequests(tx, ids);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(scope.files.map((row) => row.assetId))}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId", "mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(scope.files.map((row) => row.assetId))}) ORDER BY "assetId", "mediaId" FOR SHARE`,
  );
  await lockNativeSubtitleRows(
    tx,
    scope.files.map((row) => row.assetId),
  );
  await lockSubtitlePolicies(tx);
  const profileIds = scope.media.flatMap((row) =>
    row.profile === null
      ? []
      : [z.object({ id: z.uuid() }).parse(row.profile).id],
  );
  if (profileIds.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id IN (${Prisma.join(profileIds)}) ORDER BY id FOR SHARE`,
    );
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" ORDER BY "rootPath" FOR UPDATE`;
}

export async function assertNativeSnapshot(
  tx: Prisma.TransactionClient,
  planId: string,
  scope: NativeRecoveryScope,
) {
  await assertNativeExclusion(tx);
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const mode = scope.request.activation === "activate" ? "observe" : "active";
  const authority = await runtimeAuthority(tx);
  if (
    runtime.mode !== mode ||
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    runtime.version !== plan.runtimeVersion ||
    plan.restoreOperationId !== scope.request.restoreOperationId ||
    (mode === "observe" && runtime.ownershipConfirmed) ||
    (mode === "active" && !authority.active)
  )
    throw new Error("Native recovery runtime changed");
  if (
    snapshotHash(
      z.json().parse(NativeRecoveryScopeSchema.parse(plan.scope)),
    ) !== snapshotHash(z.json().parse(scope)) ||
    snapshotHash(z.json().parse(await buildNativeScope(tx, scope.request))) !==
      snapshotHash(z.json().parse(scope))
  )
    throw new Error("Native recovery reviewed records changed");
  return { plan, runtime };
}
