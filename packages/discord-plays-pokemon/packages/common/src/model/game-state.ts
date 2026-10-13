import { z } from "zod";

/** What the engine is doing, as the emulator's observation reports it. */
export const GamePhaseSchema = z.enum([
  "unavailable",
  "overworld",
  "scripted",
  "battle",
  "other",
]);

export type PartyMon = z.infer<typeof PartyMonSchema>;
export const PartyMonSchema = z.strictObject({
  species: z.string(),
  /** National Dex ID for sprite lookup; eggs have no species sprite. */
  nationalDexNumber: z.number().int().min(1).max(386).nullable(),
  nickname: z.string(),
  level: z.number().int(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  isEgg: z.boolean(),
});

export type GoalView = z.infer<typeof GoalViewSchema>;
export const GoalViewSchema = z.strictObject({
  goal: z.string(),
  status: z.enum([
    "running",
    "completed",
    "failed",
    "timeout",
    "replaced",
    "shutdown",
  ]),
});

/**
 * The game as the web page shows it: a compact read of the save and engine,
 * pushed whenever it changes. Names are display names, title-cased.
 */
export type GameStateView = z.infer<typeof GameStateViewSchema>;
export const GameStateViewSchema = z.strictObject({
  phase: GamePhaseSchema,
  /** The current map's name, or null outside the overworld. */
  location: z.string().nullable(),
  party: z.array(PartyMonSchema),
  /** Badges 1-8 in Hoenn order; true when earned. */
  badges: z.array(z.boolean()).length(8),
  pokedexOwned: z.number().int(),
  money: z.number().int().nullable(),
  /** The goal agent's current or most recent goal, when goal mode exists. */
  goal: GoalViewSchema.nullable(),
});

export type StateResponse = z.infer<typeof StateResponseSchema>;
export const StateResponseSchema = z.strictObject({
  kind: z.literal("state"),
  /** Null when no game session is running. */
  value: GameStateViewSchema.nullable(),
});
