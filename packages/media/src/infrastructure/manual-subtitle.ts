import type { Prisma } from "#generated/prisma/client.ts";
import type { ManualSubtitle } from "#shared/admin.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { MediaError } from "#application/errors.ts";
import { lockDefaultScopes } from "./editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

export function parseManualSubtitle(input: ManualSubtitle, bytes: Uint8Array) {
  try {
    return validateSubtitle({
      bytes,
      filename: input.filename,
      provenanceText: input.description,
      requireSimplified: input.language === "zh-Hans",
      ...(input.declaredEncoding === undefined
        ? {}
        : { declaredEncoding: input.declaredEncoding }),
    });
  } catch {
    throw new MediaError(
      "subtitle_invalid",
      "Subtitle timing, encoding, script, or human translation evidence could not be validated",
      422,
    );
  }
}
export async function lockSubtitleAsset(
  tx: Prisma.TransactionClient,
  input: ManualSubtitle,
) {
  const before = await tx.libraryAsset.findUnique({
    where: { id: input.assetId },
    include: { coverage: { where: { current: true } } },
  });
  if (before === null)
    throw new MediaError("asset_not_found", "Video asset does not exist", 404);
  if (before.edition !== "default")
    throw new MediaError(
      "edition_not_available",
      "This edition is not available for subtitle changes",
      409,
    );
  const ids = before.coverage.map((coverage) => coverage.mediaId);
  await lockDefaultScopes(
    tx,
    ids.map((id) => defaultScope(id)),
    { createMissing: false },
  );
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: input.assetId },
    include: { coverage: { where: { current: true } } },
  });
  if (
    !asset.owned ||
    asset.edition !== "default" ||
    asset.state !== "published" ||
    asset.checksum !== input.expectedChecksum ||
    asset.version !== input.expectedAssetVersion ||
    ids.length === 0 ||
    asset.coverage.length !== ids.length ||
    asset.coverage.some(
      (coverage) =>
        coverage.edition !== "default" || !ids.includes(coverage.mediaId),
    )
  )
    throw new MediaError(
      "asset_version_conflict",
      "The owned video version changed; select it again",
      409,
    );
  return asset;
}
