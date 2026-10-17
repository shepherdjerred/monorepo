import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeArchiveScopeSchema,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { hasPendingLegacyClaims } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { lockNativeSubtitleRows } from "#automation/native-subtitles/snapshot.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { buildNativeArchiveScope } from "./scope.ts";

export async function lockNativeArchiveScope(
  tx: Prisma.TransactionClient,
  scope: NativeArchiveScope,
) {
  const ids = scope.media.map((row) => row.id);
  await lockDefaultMedia(tx, ids);
  await lockEffectiveRequests(tx, ids);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id='singleton' FOR UPDATE`;
  // Acquire the same hold/user/mapping/knowledge fence used by destructive guards.
  // Unresolved household knowledge remains protected by the holds created at apply.
  await hasPendingLegacyClaims(tx, ids);
  const cleanups = [
    ...new Set([
      ...scope.edges.map((row) => row.id),
      ...scope.terminalDependencies.map((row) => row.dependency.cleanupId),
    ]),
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "UpgradeCleanup" WHERE id IN (${Prisma.join(cleanups)}) ORDER BY id FOR UPDATE`,
  );
  const assets = [
    ...new Set([
      ...scope.files.map((row) => row.assetId),
      ...scope.terminalDependencies.flatMap((row) => row.dependency.assetIds),
    ]),
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR SHARE`,
  );
  await lockNativeSubtitleRows(tx, assets);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "NativeArchiveCleanupContinuation" WHERE "originalCleanupId" IN (${Prisma.join(cleanups)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE "mediaIds" && ARRAY[${Prisma.join(ids)}]::text[] ORDER BY id FOR SHARE`,
  );
  await lockSubtitlePolicies(tx);
  const profiles = scope.media.flatMap((row) =>
    row.profile === null
      ? []
      : [z.object({ id: z.uuid() }).parse(row.profile).id],
  );
  if (profiles.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id IN (${Prisma.join(profiles)}) ORDER BY id FOR SHARE`,
    );
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" ORDER BY "rootPath" FOR UPDATE`;
}
export async function assertNativeArchiveSnapshot(
  tx: Prisma.TransactionClient,
  planId: string,
  scope: NativeArchiveScope,
) {
  await assertNativeExclusion(tx);
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const authority = await runtimeAuthority(tx);
  if (
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    runtime.version !== plan.runtimeVersion ||
    plan.restoreOperationId !== scope.request.restoreOperationId ||
    (scope.request.activation === "activate"
      ? runtime.mode !== "observe" || runtime.ownershipConfirmed
      : !authority.active)
  )
    throw new Error("Native archive runtime changed");
  if (
    snapshotHash(z.json().parse(NativeArchiveScopeSchema.parse(plan.scope))) !==
      snapshotHash(z.json().parse(scope)) ||
    snapshotHash(
      z.json().parse(await buildNativeArchiveScope(tx, scope.request)),
    ) !== snapshotHash(z.json().parse(scope))
  )
    throw new Error("Native archive reviewed records changed");
  return { plan, runtime };
}
