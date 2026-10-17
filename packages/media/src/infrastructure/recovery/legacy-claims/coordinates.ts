import type { Prisma } from "#generated/prisma/client.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { catalogIdentity } from "#migration/catalog-targets.ts";
export type LegacyRequest = Extract<MigrationRecord, { kind: "request" }>;
type Item = Prisma.MediaItemGetPayload<{
  include: { parent: { include: { parent: true } } };
}>;
function requestRoot(item: Item, kind: "movie" | "series") {
  return [item, item.parent, item.parent?.parent].find(
    (parent) => parent?.kind === kind,
  );
}
export async function projectLegacyCoordinates(
  db: Prisma.TransactionClient,
  request: LegacyRequest,
  selected: Item[],
) {
  const kind = request.scope === "movie" ? "movie" : "series";
  const roots = [
    ...new Map(
      selected
        .map((item) => requestRoot(item, kind))
        .filter((item) => item !== undefined && item !== null)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const supplied = Object.entries(request.externalIds);
  if (supplied.length === 0)
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_identity_unknown",
      relevant: true,
    };
  const matches = roots.filter((root) => {
    const ids = catalogIdentity(root);
    return supplied.some(([key, value]) => Reflect.get(ids, key) === value);
  });
  if (matches.length === 0)
    return { mediaIds: [], outsideMediaIds: [], reason: null, relevant: false };
  const root = matches[0];
  if (
    root === undefined ||
    matches.length !== 1 ||
    supplied.some(
      ([key, value]) => Reflect.get(catalogIdentity(root), key) !== value,
    )
  )
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_identity_conflict",
      relevant: true,
    };
  if (request.scope === "episode")
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_episode_coordinates_missing",
      relevant: true,
    };
  if (request.scope === "movie")
    return {
      mediaIds: [root.id],
      outsideMediaIds: [],
      reason: null,
      relevant: true,
    };
  if (root.catalogState !== "ready")
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_catalog_incomplete",
      relevant: true,
    };
  const children = await db.mediaItem.findMany({
    where: { OR: [{ parentId: root.id }, { parent: { parentId: root.id } }] },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const seasons = new Set(request.seasons);
  if (
    children.length > 1000 ||
    (request.scope === "season" && seasons.size === 0) ||
    seasons.size !== request.seasons.length
  )
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_projection_unbounded_or_ambiguous",
      relevant: true,
    };
  const episodes = children.filter(
    (item) =>
      item.kind === "episode" &&
      (seasons.size === 0 ||
        (item.seasonNumber !== null && seasons.has(item.seasonNumber))),
  );
  if (
    episodes.length === 0 ||
    episodes.some(
      (item) =>
        item.catalogState !== "ready" ||
        item.seasonNumber === null ||
        item.episodeNumber === null,
    ) ||
    [...seasons].some(
      (season) =>
        !children.some(
          (item) =>
            item.kind === "season" &&
            item.seasonNumber === season &&
            item.catalogState === "ready",
        ),
    )
  )
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_catalog_incomplete",
      relevant: true,
    };
  const coordinates = episodes.map(
    (item) => `${String(item.seasonNumber)}:${String(item.episodeNumber)}`,
  );
  if (new Set(coordinates).size !== episodes.length)
    return {
      mediaIds: [],
      outsideMediaIds: [],
      reason: "legacy_claim_numbering_ambiguous",
      relevant: true,
    };
  const selectedIds = new Set(selected.map((item) => item.id));
  return {
    mediaIds: episodes
      .filter((item) => selectedIds.has(item.id))
      .map((item) => item.id)
      .sort(),
    outsideMediaIds: episodes
      .filter((item) => !selectedIds.has(item.id))
      .map((item) => item.id)
      .sort(),
    reason: null,
    relevant: episodes.some((item) => selectedIds.has(item.id)),
  };
}
