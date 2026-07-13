import { z } from "zod";

/**
 * Zod schemas for DuckDB result rows. DuckDB returns BIGINT aggregates as js
 * bigint; every count is transformed to number with a safe-integer guard
 * (report sums are far below 2^53 — a violation means something is deeply
 * wrong and should fail loudly).
 */

const LakeCountSchema = z
  .union([z.bigint(), z.number()])
  .transform((value, ctx) => {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      ctx.addIssue({
        code: "custom",
        message: `aggregate value ${value.toString()} exceeds safe integer range`,
      });
      return z.NEVER;
    }
    return asNumber;
  });

export const LakeAggregateRowSchema = z.object({
  label: z.string(),
  discord_id: z.string().nullable(),
  games: LakeCountSchema,
  wins: LakeCountSchema,
  surrenders: LakeCountSchema,
  kills: LakeCountSchema,
  deaths: LakeCountSchema,
  assists: LakeCountSchema,
  creep_score: LakeCountSchema,
  damage_to_champions: LakeCountSchema,
  gold_earned: LakeCountSchema,
  vision_score: LakeCountSchema,
  damage_taken: LakeCountSchema,
  total_damage_dealt: LakeCountSchema,
  wards_placed: LakeCountSchema,
  multikills: LakeCountSchema,
  duration_seconds: LakeCountSchema,
  time_played_seconds: LakeCountSchema,
});

export type LakeAggregateRow = z.infer<typeof LakeAggregateRowSchema>;

export const LakeScannedRowSchema = z.object({
  scanned: LakeCountSchema,
});

// Raw per-player fact row returned by compileGroupFactsQuery — one row per
// (match, team, subteam, player). Combination generation happens in JS.
export const LakeGroupFactRowSchema = z.object({
  player_id: LakeCountSchema,
  player_alias: z.string(),
  match_id: z.string(),
  team_id: LakeCountSchema,
  player_subteam_id: LakeCountSchema.nullable(),
  win: z.boolean(),
  surrendered: z.boolean(),
  kills: LakeCountSchema,
  deaths: LakeCountSchema,
  assists: LakeCountSchema,
  creep_score: LakeCountSchema,
  damage_to_champions: LakeCountSchema,
  gold_earned: LakeCountSchema,
  vision_score: LakeCountSchema,
  damage_taken: LakeCountSchema,
  total_damage_dealt: LakeCountSchema,
  wards_placed: LakeCountSchema,
  multikills: LakeCountSchema,
  game_duration_seconds: LakeCountSchema,
  time_played_seconds: LakeCountSchema,
});

export type LakeGroupFactRow = z.infer<typeof LakeGroupFactRowSchema>;
