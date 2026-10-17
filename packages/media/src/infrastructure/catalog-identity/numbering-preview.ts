import { MediaError } from "#application/errors.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  NumberingGroupDetailSchema,
  NumberingGroupPreviewSchema,
  type PreviewNumberingGroup,
} from "#shared/acquisition/numbering.ts";
import type { NumberingCatalog } from "./numbering-snapshot.ts";

export async function loadNumberingGroup(
  tmdb: TmdbClient,
  seriesTmdbId: number,
  groupId: string,
) {
  const [listing, group] = await Promise.all([
    tmdb.episodeGroups(seriesTmdbId),
    tmdb.episodeGroup(groupId),
  ]);
  const entry = listing.groups.find((item) => item.id === groupId);
  if (
    entry?.type !== 2 ||
    group.type !== 2 ||
    entry.episodeCount !== group.episodeCount ||
    entry.groupCount !== group.groupCount
  )
    throw new MediaError(
      "group_identity",
      "Select an Absolute group listed for this exact series",
      409,
    );
  const episodes = group.groups.flatMap((subgroup) => subgroup.episodes);
  if (
    group.groupCount !== group.groups.length ||
    group.episodeCount !== episodes.length ||
    new Set(group.groups.map((item) => item.id)).size !== group.groups.length ||
    new Set(episodes.map((item) => item.id)).size !== episodes.length ||
    episodes.some((episode) => episode.showId !== seriesTmdbId)
  )
    throw new MediaError(
      "group_incomplete",
      "Group counts, series identity or unique episode membership changed",
      409,
    );
  return group;
}
export type NumberingGroup = Awaited<ReturnType<typeof loadNumberingGroup>>;

export function numberingGroupDetail(seriesId: string, group: NumberingGroup) {
  return NumberingGroupDetailSchema.parse({
    seriesId,
    groupId: group.id,
    groupDigest: snapshotHash(group),
    name: group.name,
    type: group.type,
    subgroups: group.groups.map((item) => ({
      id: item.id,
      name: item.name,
      order: item.order,
      episodeCount: item.episodes.length,
      firstOrder:
        item.episodes.length === 0
          ? null
          : Math.min(...item.episodes.map((episode) => episode.order)),
      lastOrder:
        item.episodes.length === 0
          ? null
          : Math.max(...item.episodes.map((episode) => episode.order)),
    })),
  });
}

export function buildNumberingPreview(
  catalog: NumberingCatalog,
  group: NumberingGroup,
  interpretation: PreviewNumberingGroup,
) {
  if (group.id !== interpretation.groupId)
    throw new Error("Numbering group identity changed");
  for (const subgroup of group.groups)
    for (const episode of subgroup.episodes) {
      const matches = catalog.episodes.filter(
        (item) => item.tmdbId === episode.id,
      );
      if (
        matches.length !== 1 ||
        matches[0]?.seasonNumber !== episode.seasonNumber ||
        matches[0].episodeNumber !== episode.episodeNumber
      )
        throw new MediaError(
          "group_episode_unmapped",
          "Every group episode must join exactly to this series catalog",
          409,
        );
    }
  const subgroup = group.groups.find(
    (item) => item.id === interpretation.subgroupId,
  );
  if (subgroup === undefined || subgroup.episodes.length === 0)
    throw new MediaError("group_empty", "Select a nonempty subgroup", 409);
  const ordered = [...subgroup.episodes].sort((a, b) => a.order - b.order);
  const first = ordered[0];
  if (first === undefined)
    throw new Error("Numbering subgroup missing first episode");
  if (ordered.some((item, index) => item.order !== first.order + index))
    throw new MediaError(
      "group_order_ambiguous",
      "Subgroup orders must be unique and contiguous before applying the chosen start",
      409,
    );
  const groupDigest = snapshotHash(group);
  const mappings = ordered
    .slice(interpretation.offset, interpretation.offset + 100)
    .map((episode) => {
      const item = catalog.episodes.find((row) => row.tmdbId === episode.id);
      if (item === undefined)
        throw new Error("Previously joined group episode disappeared");
      const absoluteNumber =
        interpretation.firstAbsoluteNumber + episode.order - first.order;
      return {
        episodeId: item.id,
        expectedVersion: item.version,
        title: item.title,
        tmdbEpisodeId: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        rawOrder: episode.order,
        absoluteNumber,
        previousAbsoluteNumber: item.absoluteNumber,
        existingProvenance: item.provenance,
        requiresOverride:
          item.absoluteNumber !== null &&
          (item.absoluteNumber !== absoluteNumber ||
            item.provenance.kind !== "tmdb_group" ||
            item.provenance.groupDigest !== groupDigest),
        provenance: {
          kind: "tmdb_group" as const,
          groupId: group.id,
          groupDigest,
          episodeId: episode.id,
          entryDigest: snapshotHash(episode),
          subgroupId: subgroup.id,
          subgroupOrder: subgroup.order,
          episodeOrder: episode.order,
          firstAbsoluteNumber: interpretation.firstAbsoluteNumber,
        },
      };
    });
  const snapshot = {
    schemaVersion: 1 as const,
    seriesId: catalog.series.id,
    seriesVersion: catalog.series.version,
    interpretation,
    groupDigest,
    catalogDigest: catalog.catalogDigest,
    numberingDigest: catalog.numberingDigest,
    mappings,
    nextOffset:
      interpretation.offset + mappings.length < ordered.length
        ? interpretation.offset + mappings.length
        : null,
  };
  return NumberingGroupPreviewSchema.parse({
    ...snapshot,
    previewDigest: snapshotHash(snapshot),
  });
}
