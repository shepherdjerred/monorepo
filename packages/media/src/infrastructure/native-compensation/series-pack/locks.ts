import { Prisma } from "#generated/prisma/client.ts";
import type { SeriesPackPublicationIntentRefV3 } from "#shared/acquisition/series-pack-publication-v1.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockNativeSubtitleRows } from "#automation/native-subtitles/snapshot.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { lockLegacyClaimKnowledge } from "#infrastructure/recovery/legacy-claims/knowledge-fence.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";

/** Locator grants no authority; every queried immutable parent is resolved after these locks. */
export async function lockSeriesPackNativeScopeV1(
  tx: Prisma.TransactionClient,
  publication: SeriesPackPublicationIntentRefV3,
) {
  const intent = publication.intent;
  const ids = [...intent.mediaIds].sort();
  const assets = [
    ...new Set(
      intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  await lockDefaultMedia(tx, ids);
  await lockEffectiveRequests(tx, ids);
  await tx.$queryRaw(
    Prisma.sql`SELECT "rootRequestId","mediaId" FROM "RequestCoverage" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY "rootRequestId","mediaId" FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "RetentionHold" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "RecoveryHold" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId" FOR UPDATE`,
  );
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id='singleton' FOR UPDATE`;
  // Match the mature native lock order: whole household identity/mapping and
  // legacy-knowledge fences precede cleanup/assets. This read grants nothing;
  // final authority still checks the actual pending-claim result afresh.
  const users = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "MediaUser" ORDER BY id LIMIT 101 FOR SHARE`;
  if (users.length > 100)
    throw new NativeCompensationProtection(
      "compensation_household_reconciliation_required",
    );
  if (users.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(users.map((row) => row.id))}) ORDER BY "userId" FOR SHARE`,
    );
  await lockLegacyClaimKnowledge(tx);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "UpgradeCleanup" WHERE "assetId" IN (${Prisma.join(assets)}) OR "successorAssetId" IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
  );
  await lockNativeSubtitleRows(tx, assets);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE "mediaIds" && ARRAY[${Prisma.join(ids)}]::text[] ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId",edition FROM "AcquisitionReservation" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId",edition FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "RetentionDecision" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw`SELECT id FROM "MediaPublicationTransition" WHERE id=${publication.transitionId} FOR UPDATE`;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "NativePublicationCompensationContinuation" WHERE "mediaIds" && ARRAY[${Prisma.join(ids)}]::text[] OR "assetIds" && ARRAY[${Prisma.join(assets)}]::text[] ORDER BY id FOR UPDATE`,
  );
  await lockSubtitlePolicies(tx);
  await tx.$queryRaw`SELECT id FROM "QualityProfile" ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" ORDER BY "rootPath" FOR UPDATE`;
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId",edition FROM "PlexBindingCurrent" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId",edition FOR UPDATE`,
  );
}
