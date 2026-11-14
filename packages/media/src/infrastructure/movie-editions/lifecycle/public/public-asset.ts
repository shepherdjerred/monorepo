import type { Prisma } from "#generated/prisma/client.ts";
import { MovieTargetAssetV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { publicAssetProperties } from "#infrastructure/visibility/access.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import type { policyStatus } from "#infrastructure/subtitle-policy.ts";

/** A safe operational presentation only; it supplies no source/receipt or physical permission. */
export function moviePublicTargetAssetV4(
  asset:
    Prisma.LibraryAssetGetPayload<{ include: { subtitles: true } }> | undefined,
  epoch: number,
  subtitleStatus: ReturnType<typeof policyStatus> = null,
) {
  if (asset === undefined) return null;
  return MovieTargetAssetV4Schema.parse({
    id: asset.id,
    version: asset.version,
    state: asset.state,
    properties: publicAssetProperties(asset.properties),
    captions: asset.subtitles.slice(0, 100).map((subtitle) => ({
      id: subtitle.id,
      language: subtitle.language,
      state: subtitle.state,
      qualityStatus: subtitle.qualityStatus,
      storageKind: subtitle.storageKind,
      forced: subtitle.forced,
      hearingImpaired: subtitle.hearingImpaired,
      accepted: subtitleAccepted({ subtitle, asset, epoch }),
    })),
    captionsTruncated: asset.subtitles.length > 100,
    subtitleStatus,
  });
}
