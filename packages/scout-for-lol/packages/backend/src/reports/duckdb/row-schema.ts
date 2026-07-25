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
  participant_rows: LakeCountSchema,
  early_surrenders: LakeCountSchema,
  lane_minions: LakeCountSchema,
  neutral_minions: LakeCountSchema,
  gold_spent: LakeCountSchema,
  damage_mitigated: LakeCountSchema,
  damage_to_objectives: LakeCountSchema,
  damage_to_turrets: LakeCountSchema,
  healing: LakeCountSchema,
  teammate_healing: LakeCountSchema,
  wards_killed: LakeCountSchema,
  control_wards_bought: LakeCountSchema,
  detector_wards_placed: LakeCountSchema,
  double_kills: LakeCountSchema,
  triple_kills: LakeCountSchema,
  quadra_kills: LakeCountSchema,
  penta_kills: LakeCountSchema,
  largest_multikill: LakeCountSchema,
  killing_sprees: LakeCountSchema,
  first_bloods: LakeCountSchema,
  champion_level_total: LakeCountSchema,
  champion_experience_total: LakeCountSchema,
  time_dead_seconds: LakeCountSchema,
  longest_life_seconds: LakeCountSchema,
  cc_time_seconds: LakeCountSchema,
  turret_kills: LakeCountSchema,
  inhibitor_kills: LakeCountSchema,
  dragon_kills: LakeCountSchema,
  baron_kills: LakeCountSchema,
  arena_rows: LakeCountSchema,
  placement_sum: LakeCountSchema,
  top_two_placements: LakeCountSchema,
  first_place_finishes: LakeCountSchema,
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
  early_surrendered: z.boolean(),
  lane_minions: LakeCountSchema,
  neutral_minions: LakeCountSchema,
  gold_spent: LakeCountSchema,
  damage_mitigated: LakeCountSchema,
  damage_to_objectives: LakeCountSchema,
  damage_to_turrets: LakeCountSchema,
  healing: LakeCountSchema,
  teammate_healing: LakeCountSchema,
  wards_killed: LakeCountSchema,
  control_wards_bought: LakeCountSchema,
  detector_wards_placed: LakeCountSchema,
  double_kills: LakeCountSchema,
  triple_kills: LakeCountSchema,
  quadra_kills: LakeCountSchema,
  penta_kills: LakeCountSchema,
  largest_multikill: LakeCountSchema,
  killing_sprees: LakeCountSchema,
  first_blood: z.boolean(),
  champion_level: LakeCountSchema,
  champion_experience: LakeCountSchema,
  time_dead_seconds: LakeCountSchema,
  longest_life_seconds: LakeCountSchema,
  cc_time_seconds: LakeCountSchema,
  turret_kills: LakeCountSchema,
  inhibitor_kills: LakeCountSchema,
  dragon_kills: LakeCountSchema,
  baron_kills: LakeCountSchema,
  placement: LakeCountSchema.nullable(),
});

export type LakeGroupFactRow = z.infer<typeof LakeGroupFactRowSchema>;
