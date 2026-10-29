import { z } from "zod";

const Id = z.int().positive();
const Text = z.string().max(2000);
export const GroupIdSchema = z.string().regex(/^[\w-]{1,100}$/u);
const Alias = z.object({
  title: Text.min(1),
  iso_3166_1: z.string().length(2),
  type: Text,
});
export const MovieTitlesSchema = z.object({
  id: Id,
  titles: z.array(Alias).max(500),
});
export const SeriesTitlesSchema = z.object({
  id: Id,
  results: z.array(Alias).max(500),
});
export const EpisodeGroupsSchema = z.object({
  id: Id,
  results: z
    .array(
      z.object({
        id: GroupIdSchema,
        name: Text,
        type: z.int().min(1).max(7),
        episode_count: z.int().nonnegative().max(5000),
        group_count: z.int().nonnegative().max(500),
      }),
    )
    .max(500),
});
export const EpisodeGroupSchema = z
  .object({
    id: GroupIdSchema,
    name: Text,
    type: z.int().min(1).max(7),
    episode_count: z.int().nonnegative().max(5000),
    group_count: z.int().nonnegative().max(500),
    groups: z
      .array(
        z.object({
          id: GroupIdSchema,
          name: Text,
          order: z.int().nonnegative(),
          locked: z.boolean(),
          episodes: z
            .array(
              z.object({
                id: Id,
                show_id: Id,
                season_number: z.int().nonnegative(),
                episode_number: z.int().nonnegative(),
                order: z.int().nonnegative(),
              }),
            )
            .max(5000),
        }),
      )
      .max(500),
  })
  .refine(
    (group) =>
      group.groups.reduce(
        (count, subgroup) => count + subgroup.episodes.length,
        0,
      ) <= 5000,
    "Episode group exceeds total bound",
  );

export function normalizeEpisodeGroup(
  group: z.infer<typeof EpisodeGroupSchema>,
) {
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    episodeCount: group.episode_count,
    groupCount: group.group_count,
    groups: group.groups.map((subgroup) => ({
      id: subgroup.id,
      name: subgroup.name,
      order: subgroup.order,
      locked: subgroup.locked,
      episodes: subgroup.episodes.map((episode) => ({
        id: episode.id,
        showId: episode.show_id,
        seasonNumber: episode.season_number,
        episodeNumber: episode.episode_number,
        order: episode.order,
      })),
    })),
  };
}
