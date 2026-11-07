import { z } from "zod";
import type { Operation } from "#generated/prisma/client.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieSourceCohort } from "./movie-types.ts";

/** This exact protocol uses sourcePath only as a provider filename; Files consumes asset.path.
 * Caller separately proves each actual asset's committed bytes/path outside the source directory. */
export function movieCaptionLibraryTargetV1(
  operation: Operation,
  torrent: MovieSourceCohort,
  scope: MovieEditionScope,
) {
  if (operation.kind !== "acquire_movie_subtitles_v4") return null;
  const parsed = z
    .object({
      ...MovieSubtitleOperationV4Schema.shape,
      kind: z.literal("acquire_movie_subtitles_v4"),
    })
    .safeParse(operation.payload);
  if (!parsed.success) return null;
  const input = parsed.data;
  return input.operationId === operation.id &&
    input.assetId === operation.targetId &&
    input.recoveryEpoch === torrent.ownershipEpoch &&
    identityHash(input.scope) === identityHash(scope)
    ? input.assetId
    : null;
}

export function movieCaptionUsesPublishedLibrary(
  operation: Operation,
  torrent: MovieSourceCohort,
  scope: MovieEditionScope,
): boolean {
  const assetId = movieCaptionLibraryTargetV1(operation, torrent, scope);
  return (
    assetId !== null &&
    torrent.assets.some(
      (asset) =>
        asset.id === assetId &&
        asset.state === "published" &&
        asset.owned &&
        asset.checksum !== null,
    )
  );
}
