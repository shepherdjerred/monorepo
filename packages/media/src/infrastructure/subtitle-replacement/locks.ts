import type { Prisma } from "#generated/prisma/client.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";

/** Media row locks serialize this read with creation/release of a reservation. */
export async function assertNoSubtitleReplacement(
  tx: Prisma.TransactionClient,
  assetIds: readonly string[],
  exceptId?: string,
) {
  const active = await tx.subtitleReplacement.findFirst({
    where: {
      assetId: { in: [...assetIds] },
      reservationActive: true,
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
  });
  if (active !== null)
    throw new FileGuardError("subtitle_replacement_unsettled");
}

export async function lockSubtitleReplacementScope(
  tx: Prisma.TransactionClient,
  input: {
    assetId: string;
    mediaIds: readonly string[];
    replacementId?: string;
    movieScope?: MovieEditionScope;
  },
) {
  if (input.movieScope === undefined)
    await lockDefaultMedia(tx, [...input.mediaIds]);
  else {
    if (
      input.mediaIds.length !== 1 ||
      input.mediaIds[0] !== input.movieScope.mediaId
    )
      throw new FileGuardError("movie_subtitle_scope_changed");
    await lockMovieCommand(tx, input.movieScope);
  }
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: input.mediaIds,
    assetIds: [input.assetId],
  });
  await lockEffectiveRequests(tx, [...input.mediaIds]);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  await lockSubtitlePolicies(tx);
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id = ${input.assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId" = ${input.assetId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleReplacement" WHERE "assetId" = ${input.assetId} ORDER BY id FOR UPDATE`;
  await assertNoSubtitleReplacement(tx, [input.assetId], input.replacementId);
}

export async function assertReplacementOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  if (actor.role !== "owner" || actor.restricted)
    throw new MediaError(
      "forbidden",
      "Subtitle replacement requires the current unrestricted owner",
      403,
    );
  return actor;
}
