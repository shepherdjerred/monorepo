import type { Prisma } from "#generated/prisma/client.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { MediaError } from "#application/errors.ts";

/** Acquire canonical roots first, then affected non-root rows. Call before claims/runtime/identity locks. */
export async function lockAcquisitionMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: [...new Set(mediaIds)] } },
    include: { parent: { include: { parent: true } } },
  });
  if (rows.length !== new Set(mediaIds).size)
    throw new MediaError("media_not_found", "Media coverage changed", 409);
  const roots = rows.map((row) => {
    if (row.kind === "movie" || row.kind === "series") return row.id;
    const series =
      row.parent?.kind === "series" ? row.parent : row.parent?.parent;
    if (series?.kind !== "series")
      throw new MediaError(
        "canonical_series_missing",
        "Episode has no canonical series",
        409,
      );
    return series.id;
  });
  await lockMedia(tx, roots);
  await lockMedia(
    tx,
    mediaIds.filter((id) => !roots.includes(id)),
  );
  const current = await tx.mediaItem.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: { id: true, parentId: true, kind: true },
  });
  if (
    current.some((row) => {
      const prior = rows.find((item) => item.id === row.id);
      return prior?.parentId !== row.parentId || prior.kind !== row.kind;
    })
  )
    throw new MediaError(
      "canonical_ancestry_changed",
      "Canonical media ancestry changed",
      409,
    );
}
