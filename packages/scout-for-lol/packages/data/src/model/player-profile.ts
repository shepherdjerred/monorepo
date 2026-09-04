import { z } from "zod";
import { QueueTypeSchema, type QueueType } from "#src/model/state.ts";

export const PlayerProfileGameWindowSchema = z.union([
  z.literal(20),
  z.literal(50),
  z.literal("all"),
]);
export type PlayerProfileGameWindow = z.infer<
  typeof PlayerProfileGameWindowSchema
>;

export const PlayerProfileQueueSelectionSchema = z
  .array(QueueTypeSchema)
  .min(1)
  .max(QueueTypeSchema.options.length)
  .superRefine((queues, context) => {
    if (new Set(queues).size !== queues.length) {
      context.addIssue({
        code: "custom",
        message: "Queue selections must be unique",
      });
    }
  });
export type PlayerProfileQueueSelection = z.infer<
  typeof PlayerProfileQueueSelectionSchema
>;

export const PlayerProfileFilterSchema = z.object({
  games: PlayerProfileGameWindowSchema.default(20),
  queues: PlayerProfileQueueSelectionSchema.optional(),
});

export const PLAYER_PROFILE_QUEUE_PRESETS = {
  competitive: ["solo", "flex", "ranked 5s", "clash"],
  solo: ["solo"],
  flex: ["flex"],
  clash: ["clash", "aram clash"],
} satisfies Record<string, readonly QueueType[]>;

export const PLAYER_PROFILE_QUEUE_GROUPS = [
  {
    label: "Competitive",
    queues: ["solo", "flex", "ranked 5s", "clash", "aram clash"],
  },
  {
    label: "Standard",
    queues: ["normal", "draft pick", "quickplay", "swiftplay", "aram"],
  },
  {
    label: "Rotating",
    queues: [
      "arena",
      "arurf",
      "urf",
      "brawl",
      "aram mayhem",
      "classic",
      "classic aram mayhem",
      "custom",
    ],
  },
  {
    label: "PvE",
    queues: ["easy doom bots", "normal doom bots", "hard doom bots"],
  },
] satisfies readonly { label: string; queues: readonly QueueType[] }[];

const groupedQueues = PLAYER_PROFILE_QUEUE_GROUPS.flatMap(
  (group) => group.queues,
);
if (
  groupedQueues.length !== QueueTypeSchema.options.length ||
  new Set(groupedQueues).size !== QueueTypeSchema.options.length
) {
  throw new Error("Player profile queue groups must cover every queue once");
}

export const ChampionComparisonSortSchema = z.enum([
  "win_rate",
  "games",
  "kda",
  "cs_per_minute",
  "damage_per_minute",
  "gold_per_minute",
  "vision_per_minute",
  "alias",
]);
export type ChampionComparisonSort = z.infer<
  typeof ChampionComparisonSortSchema
>;

export const ChampionComparisonCohortSchema = z.enum([
  "qualified",
  "small_sample",
]);
export type ChampionComparisonCohort = z.infer<
  typeof ChampionComparisonCohortSchema
>;

export const ChampionComparisonCursorSchema = z.object({
  offset: z.number().int().nonnegative(),
});

export const TimelineEventFilterSchema = z.object({
  eventTypes: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  participantIds: z
    .array(z.number().int().positive().max(100))
    .max(20)
    .optional(),
});

export const TimelineCursorSchema = z.object({
  offset: z.number().int().nonnegative(),
});
