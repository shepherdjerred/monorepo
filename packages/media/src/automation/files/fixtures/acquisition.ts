import type { Database } from "#infrastructure/database.ts";
import { canonicalRootId } from "#infrastructure/editions/locks.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";

/** Seed a complete ordinary attempt at birth; never widen its immutable coverage later. */
export async function fixtureAcquisitionScope(
  db: Database,
  input: {
    mediaId: string;
    mediaIds: readonly string[];
    userId: string;
    epoch: number;
  },
) {
  const mediaIds = [...new Set(input.mediaIds)].sort();
  if (
    !mediaIds.includes(input.mediaId) ||
    mediaIds.length !== input.mediaIds.length
  )
    throw new Error("Fixture acquisition coverage is incomplete or duplicated");
  const media = await db.mediaItem.findMany({
    where: { id: { in: mediaIds } },
    include: { parent: { include: { parent: true } } },
  });
  const roots = new Set(media.map((item) => canonicalRootId(item)));
  if (
    media.length !== mediaIds.length ||
    roots.size !== 1 ||
    roots.has(null) ||
    (mediaIds.length > 1 && media.some((item) => item.kind !== "episode"))
  )
    throw new Error(
      "Fixture acquisition requires one canonical movie or TV coverage",
    );
  const targets = await db.mediaIntent.findMany({
    where: { mediaId: { in: mediaIds }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  const claims = await db.mediaRequest.findMany({
    where: {
      mediaId: { in: mediaIds },
      userId: input.userId,
      ...effectiveRequestWhere,
    },
  });
  if (
    targets.length !== mediaIds.length ||
    targets.some(
      (target) =>
        target.automationEpoch !== input.epoch ||
        !target.desiredPresence ||
        !roots.has(target.editionRootId),
    ) ||
    mediaIds.some((id) => !claims.some((claim) => claim.mediaId === id))
  )
    throw new Error(
      "Fixture acquisition requires fresh requested target coverage",
    );
  return {
    mediaIds,
    generations: Object.fromEntries(
      targets.map((target) => [target.mediaId, target.generation]),
    ),
    reservations: targets.map((target) => ({
      mediaId: target.mediaId,
      generation: target.generation,
    })),
  };
}
