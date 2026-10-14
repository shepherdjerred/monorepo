import { z } from "zod";
import { DiscordIdSchema, GameIdSchema, PlayerSchema } from "./catalog.ts";
import { GameEventSchema, PokemonStateSchema } from "./telemetry.ts";

const Count = z.number().int().nonnegative();
const ResultPlayer = z.strictObject({
  player: PlayerSchema.nullable(),
  seat: Count.max(3),
  characterId: Count,
  placement: Count.min(1).max(12),
});

export const CompletedRaceSchema = z.strictObject({
  family: z.literal("racing"),
  id: z.string(),
  at: z.iso.datetime(),
  mode: z.enum(["gp", "versus", "time-trials"]),
  courseId: Count,
  engineClass: z.string().nullable(),
  mirror: z.boolean().nullable(),
  results: z.array(
    ResultPlayer.extend({
      timeMs: Count.nullable(),
      finished: z.boolean(),
      vehicleId: Count.nullable(),
    }),
  ),
});
export const CompletedFightSchema = z.strictObject({
  family: z.literal("fighting"),
  id: z.string(),
  at: z.iso.datetime(),
  mode: z.enum(["stock", "time"]),
  stageId: Count,
  results: z.array(
    ResultPlayer.extend({
      winner: z.boolean(),
      kos: Count,
      falls: Count,
      selfDestructs: Count,
    }),
  ),
});
export const CompletedRoundSchema = z.discriminatedUnion("family", [
  CompletedRaceSchema,
  CompletedFightSchema,
]);
export type CompletedRound = z.infer<typeof CompletedRoundSchema>;

export const StandingSchema = z.strictObject({
  player: PlayerSchema,
  played: Count,
  wins: Count,
  winRate: z.number().min(0).max(1),
  podiums: Count.nullable(),
  averagePlacement: z.number().min(1).max(12).nullable(),
  kos: Count.nullable(),
  falls: Count.nullable(),
  selfDestructs: Count.nullable(),
  characters: z.array(
    z.strictObject({ characterId: Count, played: Count, wins: Count }),
  ),
  placements: z.array(Count).max(12),
});
export type Standing = z.infer<typeof StandingSchema>;

export const CourseRecordSchema = z.strictObject({
  player: PlayerSchema,
  courseId: Count,
  mode: z.enum(["gp", "versus", "time-trials"]),
  engineClass: z.string().nullable(),
  mirror: z.boolean().nullable(),
  characterId: Count,
  timeMs: Count.positive(),
});
export type CourseRecord = z.infer<typeof CourseRecordSchema>;

export const StatsSchema = z.strictObject({
  guildId: DiscordIdSchema,
  gameId: GameIdSchema,
  leaderboard: z.array(StandingSchema),
  recent: z.array(CompletedRoundSchema),
  records: z.array(CourseRecordSchema),
  milestones: z.array(GameEventSchema),
  totalRounds: Count,
  progress: PokemonStateSchema.nullable(),
});
export type Stats = z.infer<typeof StatsSchema>;
