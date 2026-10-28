import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export async function movieCleanupRecordsAuthorized(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    recoveryEpoch: number;
    assetIds: readonly string[];
  },
) {
  const { scope } = input;
  const assetIds = [...new Set(input.assetIds)];
  const target = await tx.mediaIntent.count({
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      editionRootId: scope.rootMediaId,
      automationEpoch: input.recoveryEpoch,
    },
  });
  const assets = await tx.libraryAsset.count({
    where: {
      id: { in: assetIds },
      edition: scope.edition,
      editionRootId: scope.rootMediaId,
      ownershipEpoch: input.recoveryEpoch,
      owned: true,
    },
  });
  return target === 1 && assets === assetIds.length;
}

/** Historical callers retain the exact default guard; scoped callers never infer a root from a filename. */
export async function assertCleanupPhysicalAsset(
  tx: Prisma.TransactionClient,
  assetId: string,
  scope?: MovieEditionScope,
) {
  if (scope === undefined) return assertDefaultPhysicalAsset(tx, assetId);
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { coverage: true },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  if (
    asset.edition !== scope.edition ||
    asset.editionRootId !== scope.rootMediaId ||
    target.editionRootId !== scope.rootMediaId ||
    asset.coverage.length !== 1 ||
    asset.coverage[0]?.mediaId !== scope.mediaId ||
    asset.coverage[0].edition !== scope.edition
  )
    throw new PlexBindingProtection("ownership_changed");
}
