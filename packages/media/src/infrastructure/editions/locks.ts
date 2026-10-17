import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  defaultScope,
  assertDefaultEdition,
  type DefaultEditionScope,
} from "#shared/editions/scope.ts";
import { readDefaultTarget, type EditionTarget } from "./targets.ts";

const hierarchy = {
  parent: { include: { parent: true } },
} satisfies Prisma.MediaItemInclude;
type Hierarchy = Prisma.MediaItemGetPayload<{ include: typeof hierarchy }>;

function rootOf(row: Hierarchy): string | null {
  if (row.kind === "movie" || row.kind === "series") return row.id;
  if (row.kind === "season" && row.parent?.kind === "series")
    return row.parent.id;
  if (row.kind === "episode" && row.parent?.kind === "series")
    return row.parent.id;
  return row.kind === "episode" &&
    row.parent?.kind === "season" &&
    row.parent.parent?.kind === "series"
    ? row.parent.parent.id
    : null;
}

function ancestry(row: Hierarchy): string {
  return JSON.stringify([
    row.id,
    row.kind,
    row.parentId,
    row.parent?.kind,
    row.parent?.parentId,
    row.parent?.parent?.kind,
  ]);
}

async function lockRows(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
}

async function lockCanonicalRows(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<Hierarchy[]> {
  const ids = [...new Set(mediaIds)].sort();
  if (ids.length === 0) return [];
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: hierarchy,
  });
  if (rows.length !== ids.length)
    throw new MediaError("media_not_found", "Media coverage changed", 409);
  const roots = [
    ...new Set(
      rows.flatMap((row) => {
        const root = rootOf(row);
        return root === null ? [] : [root];
      }),
    ),
  ].sort();
  await lockRows(tx, roots);
  const related = [
    ...new Set(
      rows.flatMap((row) => [
        row.id,
        ...(row.parent === null ? [] : [row.parent.id]),
      ]),
    ),
  ]
    .filter((id) => !roots.includes(id))
    .sort();
  await lockRows(tx, related);
  const current = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: hierarchy,
  });
  if (
    current.some(
      (row) =>
        ancestry(row) !==
        ancestry(rows.find((prior) => prior.id === row.id) ?? row),
    )
  )
    throw new MediaError(
      "canonical_ancestry_changed",
      "Canonical media ancestry changed",
      409,
    );
  return current;
}

/** Metadata writers lock catalog lineage without inventing acquisition targets. */
export async function lockCanonicalMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  await lockCanonicalRows(tx, mediaIds);
}

/** Caller has locked the complete canonical media set; acquire before claims/runtime. */
export async function lockExistingDefaultTargets(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(mediaIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(ids)}) AND edition = 'default' ORDER BY "mediaId" FOR UPDATE`,
  );
}

/** Locks roots, non-root ancestry, then targets. Call before claims/runtime/assets. */
export async function lockDefaultScopes(
  tx: Prisma.TransactionClient,
  scopes: readonly DefaultEditionScope[],
  options: { createMissing: boolean },
): Promise<{ target: EditionTarget; existed: boolean }[]> {
  for (const scope of scopes) assertDefaultEdition(scope.edition);
  const ids = [...new Set(scopes.map((scope) => scope.mediaId))].sort();
  if (ids.length === 0) return [];
  const current = await lockCanonicalRows(tx, ids);
  const existing = await tx.mediaIntent.findMany({
    where: { mediaId: { in: ids }, edition: "default" },
    select: { mediaId: true },
  });
  if (options.createMissing) {
    for (const row of current.filter(
      (item) => !existing.some((target) => target.mediaId === item.id),
    )) {
      const root = rootOf(row);
      if (root !== null)
        await tx.mediaEditionDefinition.upsert({
          where: { rootMediaId_key: { rootMediaId: root, key: "default" } },
          create: {
            rootMediaId: root,
            key: "default",
            policy: "standard_unmarked",
            pathLabel: "",
            plexLabel: "",
            displayLabel: "No specific edition",
          },
          update: {},
        });
      await tx.mediaIntent.create({
        data: {
          mediaId: row.id,
          editionRootId: root,
          availability: row.availability,
          desiredPresence: false,
          monitoring: false,
          automationEpoch: -1,
        },
      });
    }
  }
  await lockExistingDefaultTargets(tx, ids);
  const result = [];
  for (const id of ids) {
    const target = await readDefaultTarget(tx, defaultScope(id));
    const row = current.find((item) => item.id === id);
    if (row === undefined) throw new Error("Locked media disappeared");
    if (target.editionRootId !== null && target.editionRootId !== rootOf(row))
      throw new MediaError(
        "lineage_unresolved",
        "Default target ancestry requires reconciliation",
        409,
      );
    result.push({
      target,
      existed: existing.some((item) => item.mediaId === id),
    });
  }
  return result;
}
