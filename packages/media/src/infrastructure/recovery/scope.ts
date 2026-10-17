import { defaultIntent } from "#shared/editions/scope.ts";
import { historicalDefaultRow } from "#infrastructure/native-recovery/legacy-snapshot.ts";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { LegacyRecoveryScopeSchema } from "#shared/recovery.ts";
import { MediaError } from "#application/errors.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { unresolvedRecoveryClaims } from "./provenance.ts";
import { hasProvenNoRecoveryAccess } from "./household.ts";
import { currentNativeReceipts } from "./native-receipts.ts";
import { buildHouseholdScope } from "./household-scope.ts";
import { lockLegacyClaimKnowledge } from "./legacy-claims/knowledge-fence.ts";

export function recoveryConflict(message: string) {
  return new MediaError("recovery_review_changed", message, 409);
}
function json(value: unknown) {
  // Persist the wire projection: database Date values become ISO strings.
  const encoded = JSON.stringify(value);
  return z.json().parse(JSON.parse(encoded));
}

export async function sharedRecoveryMedia(
  db: Prisma.TransactionClient,
  selected: string[],
) {
  const ids = new Set(selected);
  for (let page = 0; page < 100; page++) {
    const rows = await db.libraryAsset.findMany({
      where: {
        edition: "default",
        state: { not: "purged" },
        coverage: { some: { mediaId: { in: [...ids] }, current: true } },
      },
      select: {
        coverage: { where: { current: true }, select: { mediaId: true } },
      },
      take: 101,
    });
    if (rows.length > 100)
      throw recoveryConflict(
        "Shared recovery scope exceeds 100 assets; reconcile a smaller physical group",
      );
    const previous = ids.size;
    for (const row of rows)
      for (const coverage of row.coverage) ids.add(coverage.mediaId);
    if (ids.size > 100)
      throw recoveryConflict("Shared recovery scope exceeds 100 media items");
    if (ids.size === previous) return [...ids].sort();
  }
  throw recoveryConflict("Shared recovery scope could not be bounded");
}

export async function lockRecoveryScope(
  db: Prisma.TransactionClient,
  ids: string[],
) {
  await lockDefaultMedia(db, ids);
  await lockEffectiveRequests(db, ids);
  await db.$queryRaw(Prisma.sql`
    SELECT r.id FROM "MediaRequest" r WHERE r."mediaId" IN (
      SELECT leaf."parentId" FROM "MediaItem" leaf WHERE leaf.id IN (${Prisma.join(ids)})
      UNION
      SELECT parent."parentId" FROM "MediaItem" leaf
      JOIN "MediaItem" parent ON parent.id = leaf."parentId"
      WHERE leaf.id IN (${Prisma.join(ids)})
    ) ORDER BY r.id FOR SHARE
  `);
  await db.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await db.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId" FOR UPDATE`,
  );
  await db.$queryRaw`SELECT id FROM "MediaUser" ORDER BY id FOR SHARE`;
  await db.$queryRaw`SELECT "userId" FROM "PlexIdentityMapping" ORDER BY "userId" FOR SHARE`;
  await lockLegacyClaimKnowledge(db);
  await db.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId" = a.id AND c.current AND c."mediaId" IN (${Prisma.join(ids)})) ORDER BY a.id FOR UPDATE`,
  );
  await db.$queryRaw(
    Prisma.sql`SELECT c."assetId", c."mediaId" FROM "AssetCoverage" c WHERE c."assetId" IN (SELECT selected."assetId" FROM "AssetCoverage" selected WHERE selected.current AND selected."mediaId" IN (${Prisma.join(ids)})) ORDER BY c."assetId", c."mediaId" FOR SHARE`,
  );
}

export async function snapshotRecoveryScope(
  db: Prisma.TransactionClient,
  ids: string[],
  machineId: string,
  version: 1 | 2 = 2,
) {
  const legacy = await snapshotLegacyRecoveryScope(db, ids, machineId);
  return version === 1 ? legacy : buildHouseholdScope(db, legacy, machineId);
}

async function snapshotLegacyRecoveryScope(
  db: Prisma.TransactionClient,
  ids: string[],
  machineId: string,
) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const media = await db.mediaItem.findMany({
    where: { id: { in: ids } },
    include: {
      intents: { where: { edition: "default" } },
      parent: { include: { parent: true } },
    },
    orderBy: { id: "asc" },
  });
  if (media.length !== ids.length)
    throw recoveryConflict("Recovery media no longer exists");
  const holds = await db.recoveryHold.findMany({
    where: { edition: "default", mediaId: { in: ids }, releasedAt: null },
    orderBy: { mediaId: "asc" },
  });
  const knownUsers = await db.mediaUser.findMany({
    include: { plexIdentity: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (knownUsers.length > 100)
    throw recoveryConflict("Household exceeds the supported review bound");
  const assets = await db.libraryAsset.findMany({
    where: {
      edition: "default",
      state: { not: "purged" },
      coverage: { some: { mediaId: { in: ids }, current: true } },
    },
    include: {
      coverage: { where: { current: true }, orderBy: { mediaId: "asc" } },
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  const coverage = await db.requestCoverage.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: [{ rootRequestId: "asc" }, { mediaId: "asc" }],
    take: 1001,
  });
  const rootIds = [...new Set(coverage.map((row) => row.rootRequestId))];
  const ancestorIds = media.flatMap((item) => recoveryAncestors(item));
  const requests = await db.mediaRequest.findMany({
    where: {
      edition: "default",
      OR: [
        { mediaId: { in: [...ids, ...ancestorIds] } },
        { id: { in: rootIds } },
      ],
    },
    orderBy: { id: "asc" },
    take: 1001,
  });
  rootIds.push(
    ...requests
      .filter((row) => ancestorIds.includes(row.mediaId))
      .map((row) => row.id),
  );
  const personalHolds = await db.retentionHold.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const relevantUserIds = new Set([
    ...requests.map((row) => row.userId),
    ...personalHolds.map((row) => row.userId),
  ]);
  const excluded = knownUsers.filter((user) =>
    hasProvenNoRecoveryAccess({ user, media, relevantUserIds, machineId }),
  );
  const users = knownUsers.filter(
    (user) => !excluded.some((item) => item.id === user.id),
  );
  if (
    coverage.length > 1000 ||
    requests.length > 1000 ||
    personalHolds.length > 1000
  )
    throw recoveryConflict(
      "Recovery request evidence exceeds the bounded review size",
    );
  const adoptions = await db.applicationEvent.findMany({
    where: { mediaId: { in: ids }, kind: "handoff_media_adopted" },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const planIds = adoptions.map(
    (row) => z.object({ planId: z.uuid() }).parse(row.payload).planId,
  );
  const receipts = await db.mediaHandoffReceipt.findMany({
    where: { planId: { in: planIds }, recoveryEpoch: runtime.recoveryEpoch },
    select: { id: true, planHash: true },
    orderBy: { id: "asc" },
  });
  const blockers = [];
  const nativeReceipts = await currentNativeReceipts(db, {
    assets,
    epoch: runtime.recoveryEpoch,
  });
  const nativeAssetIds = new Set(
    nativeReceipts.flatMap((receipt) => receipt.assetIds),
  );
  if (adoptions.length === 1000)
    blockers.push("handoff_history_requires_bounded_reconciliation");
  if (await unresolvedRecoveryClaims(db, { planIds, mediaIds: ids }))
    blockers.push("unresolved_migration_household_claim");
  if (holds.length === 0) blockers.push("no_active_recovery_hold");
  if (holds.some((hold) => hold.recoveryEpoch !== runtime.recoveryEpoch))
    blockers.push("hold_epoch_changed");
  if (media.some((item) => item.kind === "series" || item.kind === "season"))
    blockers.push("select_physical_episode_coverage");
  if (
    media.some((item) => {
      if (
        defaultIntent(item.intents)?.automationEpoch === runtime.recoveryEpoch
      )
        return false;
      const covered = assets.filter((asset) =>
        asset.coverage.some((row) => row.mediaId === item.id),
      );
      return (
        covered.length === 0 ||
        covered.some((asset) => !nativeAssetIds.has(asset.id))
      );
    })
  )
    blockers.push("selected_intent_not_rebaselined");
  if (
    assets.some(
      (asset) =>
        !asset.owned ||
        asset.ownershipEpoch !== runtime.recoveryEpoch ||
        asset.checksum === null,
    )
  )
    blockers.push("selected_assets_not_rebaselined");
  if (
    assets.some((asset) =>
      asset.coverage.some((row) => !ids.includes(row.mediaId)),
    )
  )
    blockers.push("shared_coverage_incomplete");
  if (
    users.some(
      (user) =>
        user.restricted ||
        user.plexIdentity === null ||
        user.plexIdentity.plexRestricted ||
        user.plexIdentity.kind !== "account",
    )
  )
    blockers.push("household_identity_requires_reconciliation");
  const roots = requests.filter((row) => rootIds.includes(row.id));
  if (roots.some((row) => row.active && row.coverageCompletedAt === null))
    blockers.push("root_request_projection_incomplete");
  const outside = await db.requestCoverage.count({
    where: {
      edition: "default",
      rootRequestId: { in: rootIds },
      active: true,
      mediaId: { notIn: ids },
    },
  });
  if (outside > 0) blockers.push("partial_root_request_scope");
  return LegacyRecoveryScopeSchema.parse({
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    media: media.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      sectionId:
        z
          .object({ plexSectionId: z.string().optional() })
          .parse(item.externalIds).plexSectionId ?? null,
      version: item.version,
      generation: defaultIntent(item.intents)?.generation ?? null,
      automationEpoch: defaultIntent(item.intents)?.automationEpoch ?? null,
    })),
    holds: holds.map((hold) => ({
      mediaId: hold.mediaId,
      version: hold.version,
      recoveryEpoch: hold.recoveryEpoch,
      reason: hold.reason,
      createdAt: hold.createdAt.toISOString(),
    })),
    users: users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      plexAccountId: user.plexAccountId,
      version: user.version,
      role: user.role,
      restricted: user.restricted,
      mappingVersion: user.plexIdentity?.version ?? null,
      mappingKind: user.plexIdentity?.kind ?? null,
      serverMachineId: user.plexIdentity?.serverMachineId ?? null,
      permittedSectionIds: user.plexIdentity?.permittedSectionIds ?? [],
      permittedMediaKinds: user.plexIdentity?.permittedMediaKinds ?? [],
      plexRestricted: user.plexIdentity?.plexRestricted ?? true,
    })),
    excludedUsers: excluded.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      version: user.version,
      mappingVersion: user.plexIdentity?.version ?? null,
      reason: "fresh_scope_denial_without_relevant_claim",
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      checksum: asset.checksum,
      state: asset.state,
      ownershipEpoch: asset.ownershipEpoch,
      owned: asset.owned,
      mediaIds: asset.coverage.map((row) => row.mediaId),
    })),
    requests: requests.map((row) => json(historicalDefaultRow(row))),
    coverage: coverage.map((row) => json(historicalDefaultRow(row))),
    personalHolds: personalHolds.map((row) => json(historicalDefaultRow(row))),
    handoffReceipts: receipts,
    nativeReceipts,
    blockers,
  });
}

function recoveryAncestors(item: {
  parent: { id: string; parent: { id: string } | null } | null;
}) {
  if (item.parent === null) return [];
  return item.parent.parent === null
    ? [item.parent.id]
    : [item.parent.id, item.parent.parent.id];
}
