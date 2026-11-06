import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockLegacyClaimKnowledge } from "#infrastructure/recovery/legacy-claims/knowledge-fence.ts";
import { MediaError } from "#application/errors.ts";

export function movieHistoryConflict(message: string) {
  return new MediaError("movie_history_review_changed", message, 409);
}

/** Complete current household and capture knowledge precede physical rows; no default-target prelude. */
export async function lockMovieHistoryV3(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  await lockMovieCommand(tx, scope);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id='singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId"=${scope.mediaId} AND edition=${scope.edition} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "RetentionHold" WHERE "mediaId"=${scope.mediaId} AND edition=${scope.edition} ORDER BY id FOR SHARE`;
  const users = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "MediaUser" ORDER BY id LIMIT 101 FOR SHARE`;
  if (users.length > 100)
    throw movieHistoryConflict(
      "Household review exceeds its native100-person bound",
    );
  await tx.$queryRaw`SELECT "userId" FROM "PlexIdentityMapping" ORDER BY "userId" FOR SHARE`;
  await lockLegacyClaimKnowledge(tx);
  await tx.$queryRaw`SELECT a.id FROM "LibraryAsset" a WHERE a.owned AND a.state='published' AND EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=a.id AND c."mediaId"=${scope.mediaId} AND c.edition=${scope.edition} AND c.current) ORDER BY a.id FOR UPDATE`;
  await tx.$queryRaw`SELECT c."assetId",c."mediaId",c.edition FROM "AssetCoverage" c WHERE c."mediaId"=${scope.mediaId} AND c.edition=${scope.edition} ORDER BY c."assetId",c."mediaId",c.edition FOR SHARE`;
  await tx.$queryRaw`SELECT s.id FROM "SubtitleAsset" s WHERE EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=s."assetId" AND c."mediaId"=${scope.mediaId} AND c.edition=${scope.edition} AND c.current) ORDER BY s.id FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId",edition FROM "PlexBindingCurrent" WHERE "mediaId"=${scope.mediaId} AND edition=${scope.edition} FOR SHARE`;
  await tx.$queryRaw`SELECT "rootMediaId",key FROM "MediaEditionDefinition" WHERE "rootMediaId"=${scope.rootMediaId} AND key=${scope.edition} FOR SHARE`;
  await tx.$queryRaw`SELECT p.id FROM "QualityProfile" p JOIN "MediaIntent" t ON t."profileId"=p.id WHERE t."mediaId"=${scope.mediaId} AND t.edition=${scope.edition} FOR SHARE OF p`;
}
