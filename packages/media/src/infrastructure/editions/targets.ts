import type { MediaIntent, Prisma } from "#generated/prisma/client.ts";
import type { DefaultEditionScope } from "#shared/editions/scope.ts";
import { assertDefaultEdition } from "#shared/editions/scope.ts";

export type EditionTarget = MediaIntent & {
  scope: DefaultEditionScope;
  rootMediaId: string | null;
  lineage: "resolved" | "unresolved";
  mediaVersion: number;
  targetVersion: number;
};

export function targetWhere(scope: DefaultEditionScope) {
  assertDefaultEdition(scope.edition);
  return { mediaId_edition: scope };
}

export async function findDefaultTarget(
  tx: Prisma.TransactionClient,
  scope: DefaultEditionScope,
): Promise<EditionTarget | null> {
  const row = await tx.mediaIntent.findUnique({
    where: targetWhere(scope),
    include: { media: { select: { version: true } } },
  });
  if (row === null) return null;
  const { media, ...target } = row;
  return {
    ...target,
    scope,
    rootMediaId: row.editionRootId,
    lineage: row.editionRootId === null ? "unresolved" : "resolved",
    mediaVersion: media.version,
    targetVersion: row.version,
  };
}

export async function readDefaultTarget(
  tx: Prisma.TransactionClient,
  scope: DefaultEditionScope,
): Promise<EditionTarget> {
  const target = await findDefaultTarget(tx, scope);
  if (target === null)
    throw new Error("Expected default media target is missing");
  return target;
}
