import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { DefaultEditionScope } from "#shared/editions/scope.ts";
import type { ExpectedTarget } from "#shared/editions/commands.ts";
import { targetWhere } from "./targets.ts";

export async function readCommandVersions(
  tx: Prisma.TransactionClient,
  scope: DefaultEditionScope,
): Promise<ExpectedTarget> {
  const media = await tx.mediaItem.findUnique({ where: { id: scope.mediaId } });
  if (media === null)
    throw new MediaError("media_not_found", "Media item does not exist", 404);
  const target = await tx.mediaIntent.findUnique({ where: targetWhere(scope) });
  return {
    mediaVersion: media.version,
    targetVersion: target?.version ?? null,
  };
}

/** Caller holds the complete affected canonical/media and existing-target locks. */
export async function assertDefaultCommandCas(
  tx: Prisma.TransactionClient,
  scope: DefaultEditionScope,
  expected: ExpectedTarget,
): Promise<void> {
  const current = await readCommandVersions(tx, scope);
  if (
    current.mediaVersion !== expected.mediaVersion ||
    current.targetVersion !== expected.targetVersion
  )
    throw new MediaError(
      "version_conflict",
      "Media target changed; review before continuing",
      409,
    );
}
