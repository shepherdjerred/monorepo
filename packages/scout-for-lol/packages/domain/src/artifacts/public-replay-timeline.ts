import { z } from "zod";

export const PublicReplayTimelineEventTypeSchema = z.enum([
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
]);

export const PublicReplayTimelineObjectiveSchema = z.enum([
  "DRAGON",
  "AIR_DRAGON",
  "CHEMTECH_DRAGON",
  "EARTH_DRAGON",
  "ELDER_DRAGON",
  "FIRE_DRAGON",
  "HEXTECH_DRAGON",
  "WATER_DRAGON",
  "BARON_NASHOR",
  "RIFTHERALD",
  "HORDE",
  "ATAKHAN",
  "TOWER_BUILDING",
  "INHIBITOR_BUILDING",
  "OUTER_TURRET",
  "INNER_TURRET",
  "BASE_TURRET",
  "NEXUS_TURRET",
]);

const PublicReplayTimelineEventSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  type: PublicReplayTimelineEventTypeSchema,
  objective: PublicReplayTimelineObjectiveSchema.nullable(),
  teamId: z.union([z.literal(100), z.literal(200)]).nullable(),
});

const PublicReplayTimelineSchema = z.strictObject({
  source: z.literal("riot_match_timeline"),
  events: z.array(PublicReplayTimelineEventSchema),
});

export const PublicReplayTimelineResponseSchema = z.strictObject({
  timeline: PublicReplayTimelineSchema.nullable(),
});

export type PublicReplayTimeline = z.infer<typeof PublicReplayTimelineSchema>;
export type PublicReplayTimelineEvent = z.infer<
  typeof PublicReplayTimelineEventSchema
>;
