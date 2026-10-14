import { z } from "zod";

const SeatSchema = z.number().int().min(0).max(3);
const CountSchema = z.number().int().nonnegative();
const MillisecondsSchema = z.number().nonnegative();

export const RaceStateSchema = z.strictObject({
  family: z.literal("racing"),
  phase: z.enum(["menu", "staging", "racing", "finished"]),
  round: CountSchema,
  mode: z.enum(["gp", "versus", "time-trials", "battle"]),
  courseId: CountSchema.nullable(),
  engineClass: z.string().nullable(),
  mirror: z.boolean().nullable(),
  lapCount: CountSchema.nullable(),
  racers: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(11),
        seat: SeatSchema.nullable(),
        human: z.boolean(),
        characterId: CountSchema,
        vehicleId: CountSchema.nullable(),
        lap: CountSchema.nullable(),
        placement: z.number().int().min(1).max(12).nullable(),
        timeMs: MillisecondsSchema.nullable(),
        finished: z.boolean(),
      }),
    )
    .max(12),
});
export type RaceState = z.infer<typeof RaceStateSchema>;

export const FightStateSchema = z.strictObject({
  family: z.literal("fighting"),
  phase: z.enum(["menu", "loading", "playing", "sudden-death", "results"]),
  round: CountSchema,
  mode: z.enum(["stock", "time", "other"]),
  teams: z.boolean(),
  stageId: CountSchema.nullable(),
  remainingMs: MillisecondsSchema.nullable(),
  fighters: z
    .array(
      z.strictObject({
        seat: SeatSchema,
        human: z.boolean(),
        characterId: CountSchema,
        damage: z.number().nonnegative().nullable(),
        stocks: CountSchema.nullable(),
        score: z.number().int().nullable(),
        kos: CountSchema.nullable(),
        falls: CountSchema.nullable(),
        selfDestructs: CountSchema.nullable(),
        placement: z.number().int().min(1).max(4).nullable(),
        winner: z.boolean().nullable(),
      }),
    )
    .max(4),
});
export type FightState = z.infer<typeof FightStateSchema>;

export const PokemonStateSchema = z.strictObject({
  family: z.literal("pokemon"),
  phase: z.enum(["unavailable", "overworld", "scripted", "battle", "other"]),
  location: z.string().nullable(),
  party: z
    .array(
      z.strictObject({
        species: z.string(),
        nickname: z.string(),
        level: CountSchema,
        hp: CountSchema,
        maxHp: CountSchema,
        isEgg: z.boolean(),
      }),
    )
    .max(6),
  badges: z.array(z.boolean()).length(8),
  pokedexOwned: CountSchema,
  money: CountSchema.nullable(),
  goal: z.strictObject({ goal: z.string(), status: z.string() }).nullable(),
});
export type PokemonState = z.infer<typeof PokemonStateSchema>;

export const GameStateSchema = z.discriminatedUnion("family", [
  RaceStateSchema,
  FightStateSchema,
  PokemonStateSchema,
]);
export type GameState = z.infer<typeof GameStateSchema>;

export const GameEventSchema = z.strictObject({
  id: z.string().min(1),
  at: z.iso.datetime(),
  kind: z.string().min(1),
  title: z.string(),
  text: z.string(),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

export const TelemetrySchema = z.strictObject({
  version: z.literal(1),
  frame: CountSchema,
  state: GameStateSchema,
});
