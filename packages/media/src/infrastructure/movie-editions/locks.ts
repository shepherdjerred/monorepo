import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { lockCanonicalMedia } from "#infrastructure/editions/locks.ts";
import {
  compensationGroupMedia,
  assertCompensationGroupUnchanged,
} from "#infrastructure/native-compensation/routing.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";

/** Full group before targets/claims: no primary-only prelude or late media locks. */
export async function lockMovieCommand(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  const ids =
    scope.edition === "default"
      ? await compensationGroupMedia(tx, [scope.mediaId])
      : [scope.mediaId];
  await lockCanonicalMedia(tx, ids);
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId", edition FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId", edition FOR UPDATE`,
  );
  if (scope.edition === "default")
    await assertCompensationGroupUnchanged(tx, [scope.mediaId], ids);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaRequest" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  if (media.kind !== "movie" || scope.rootMediaId !== media.id)
    throw new MediaError(
      "movie_scope_required",
      "Choose an edition for one canonical movie",
      422,
    );
  const target = await tx.mediaIntent.findUnique({
    where: { mediaId_edition: { mediaId: media.id, edition: scope.edition } },
  });
  if (target !== null && target.editionRootId !== media.id)
    throw new MediaError(
      "lineage_unresolved",
      "This target's historical lineage requires review",
      409,
    );
  return { media, target };
}

export function movieCommandConflict(): MediaError {
  return new MediaError(
    "version_conflict",
    "Movie request or edition changed; review before retrying",
    409,
  );
}
