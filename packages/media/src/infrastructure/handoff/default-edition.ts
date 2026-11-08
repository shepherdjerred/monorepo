import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { readDefaultTarget } from "#infrastructure/editions/targets.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";

export async function lockDefaultMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  const targets = await lockDefaultScopes(
    tx,
    mediaIds.map((id) => defaultScope(id)),
    {
      createMissing: false,
    },
  );
  if (targets.some(({ target }) => target.lineage !== "resolved"))
    throw new MediaError(
      "lineage_unresolved",
      "Default media lineage requires reconciliation",
      409,
    );
}

/** Caller holds canonical/target locks. A physical file must have one proven root. */
export async function defaultPhysicalRoot(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<string> {
  if (mediaIds.length === 0)
    throw new MediaError(
      "coverage_missing",
      "Physical coverage is missing",
      409,
    );
  const roots = new Set<string>();
  for (const mediaId of mediaIds) {
    const target = await readDefaultTarget(tx, defaultScope(mediaId));
    if (target.rootMediaId === null)
      throw new MediaError(
        "lineage_unresolved",
        "Physical media lineage requires reconciliation",
        409,
      );
    roots.add(target.rootMediaId);
  }
  if (roots.size !== 1)
    throw new MediaError(
      "lineage_unresolved",
      "Physical media spans canonical roots",
      409,
    );
  const root = roots.values().next().value;
  if (root === undefined) throw new Error("Proven physical root disappeared");
  return root;
}

/** Never infer a missing asset binding from a path or the first coverage row. */
export async function assertDefaultPhysicalAsset(
  tx: Prisma.TransactionClient,
  assetId: string,
): Promise<void> {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { coverage: true },
  });
  if (
    asset.edition !== "default" ||
    asset.coverage.some((coverage) => coverage.edition !== "default")
  )
    throw new MediaError(
      "edition_not_available",
      "Only the default edition is available",
      409,
    );
  if (
    asset.editionRootId === null ||
    asset.editionRootId !==
      (await defaultPhysicalRoot(
        tx,
        asset.coverage.map((item) => item.mediaId),
      ))
  )
    throw new MediaError(
      "lineage_unresolved",
      "Physical media binding requires reconciliation",
      409,
    );
}
