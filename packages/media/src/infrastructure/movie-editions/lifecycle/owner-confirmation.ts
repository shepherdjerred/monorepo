import { MovieRemovalConfirmationV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import {
  MoviePublicationAssetV2Schema,
  type MoviePublicationAssetV2,
} from "#shared/movie-editions/publication-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MediaError } from "#application/errors.ts";

/** Hash the complete actual video/caption snapshot; the public confirmation contains no paths. */
export function movieOwnerRemovalConfirmationV1(raw: MoviePublicationAssetV2) {
  const asset = MoviePublicationAssetV2Schema.parse(raw);
  if (asset.state !== "published" || !asset.coverage[0].current)
    throw new MediaError(
      "movie_removal_changed",
      "Review the currently owned serving movie before removal",
      409,
    );
  return MovieRemovalConfirmationV4Schema.parse({
    scope: asset.scope,
    fileSetHash: identityHash(asset),
    assets: [
      {
        assetId: asset.id,
        assetVersion: asset.version,
        checksum: asset.checksum,
      },
    ],
  });
}
