import { TmdbClient } from "#integrations/tmdb.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import { CatalogNumberingAdministration } from "./numbering-service.ts";
import type { NumberingGroupPreview } from "#shared/acquisition/numbering.ts";

let sequence = 2000;
export async function numberingFixture(db: Database, count = 2) {
  const tmdbId = ++sequence;
  const actor = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Numbering owner",
      role: "owner",
    },
  });
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Numbering fixture",
      tmdbId,
      catalogState: "ready",
      externalIds: { plexSectionId: "2" },
    },
  });
  const episodes = [];
  for (let index = 0; index < count; index++)
    episodes.push(
      await db.mediaItem.create({
        data: {
          kind: "episode",
          title: `Episode ${String(index)}`,
          parentId: series.id,
          tmdbId: tmdbId * 10_000 + index,
          seasonNumber: index === 0 ? 0 : 1,
          episodeNumber: index + 1,
          externalIds: {
            tmdb: tmdbId * 10_000 + index,
            seriesTmdb: tmdbId,
            plexSectionId: "2",
          },
        },
      }),
    );
  const group = {
    id: `group-${String(tmdbId)}`,
    name: "Fixture Absolute",
    type: 2,
    episode_count: count,
    group_count: 1,
    groups: [
      {
        id: "selected",
        name: "Selected",
        order: 7,
        locked: false,
        episodes: episodes.map((episode, index) => ({
          id: episode.tmdbId,
          show_id: tmdbId,
          season_number: episode.seasonNumber,
          episode_number: episode.episodeNumber,
          order: 42 + index,
        })),
      },
    ],
  };
  const hooks = { beforeDetail: () => Promise.resolve() };
  const tmdb = new TmdbClient(
    { kind: "api-key", apiKey: "fixture" },
    async (url) => {
      if (url.pathname.endsWith("episode_groups"))
        return Response.json({
          id: tmdbId,
          results: [
            {
              id: group.id,
              name: group.name,
              type: group.type,
              episode_count: group.episode_count,
              group_count: group.group_count,
            },
          ],
        });
      if (url.pathname.endsWith(`/episode_group/${group.id}`)) {
        await hooks.beforeDetail();
        return Response.json(group);
      }
      throw new Error("Unexpected fixture catalog call");
    },
  );
  return {
    db,
    actor,
    series,
    episodes,
    group,
    hooks,
    service: new CatalogNumberingAdministration(db, tmdb),
    manual: new PrismaNumberingAdministration(db, tmdb),
    interpretation: {
      groupId: group.id,
      subgroupId: "selected",
      firstAbsoluteNumber: 123,
      offset: 0,
    },
  };
}
export function commitNumberingInput(preview: NumberingGroupPreview) {
  return {
    interpretation: preview.interpretation,
    previewDigest: preview.previewDigest,
    groupDigest: preview.groupDigest,
    catalogDigest: preview.catalogDigest,
    numberingDigest: preview.numberingDigest,
    mappings: preview.mappings.map((item) => ({
      episodeId: item.episodeId,
      expectedVersion: item.expectedVersion,
      absoluteNumber: item.absoluteNumber,
    })),
    overrideEpisodeIds: preview.mappings
      .filter((item) => item.requiresOverride)
      .map((item) => item.episodeId),
  };
}
