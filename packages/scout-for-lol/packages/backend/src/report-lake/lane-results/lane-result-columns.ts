import { LaneSchema, type DuckDbColumnType } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";

/**
 * `lane_results`: one row per laner per tracked match, derived from the
 * `matches` and `timeline_participant_frames` rows the lake already holds.
 *
 * A row pairs a laner with the same-role opponent `buildRoleMatchups` pairs
 * them with, and states their gold, creep score and experience difference at
 * the 15:00 checkpoint (laner minus opponent). Only a match that
 * `buildRoleMatchups` can pair has rows. A match with no timeline, or one that
 * ended before 15:00, has rows whose differences are NULL.
 *
 * The table is derived, never staged: every fold re-derives the matches its
 * staged rows touch, and a rebuild derives every match. Readers keep the newest
 * derivation per laner (`derived_at`), so a timeline that arrives after its
 * match replaces the earlier timeline-less rows.
 */
export const LANE_RESULTS_TABLE = "lane_results";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

export const LaneResultLakeRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  /** The match's partition month, as on its `matches` rows. */
  month: z.string(),
  derived_at: z.string(),
  /** When the game began (`GAME_CREATED_AT_SQL`), for date windows. */
  game_created_at: z.string(),
  queue_id: z.number().int(),
  /** NULL for a bot or an unresolved player. */
  puuid: z.string().nullable(),
  participant_id: z.number().int(),
  team_id: z.number().int(),
  role: LaneSchema,
  champion_id: z.number().int(),
  opponent_participant_id: z.number().int(),
  opponent_puuid: z.string().nullable(),
  opponent_champion_id: z.number().int(),
  win: z.boolean(),
  /** Whether the lake holds a timeline for the match. */
  has_timeline: z.boolean(),
  /** The 15:00 checkpoint frame's timestamp; NULL when there is none. */
  checkpoint_timestamp_ms: z.number().int().nullable(),
  gold_diff_at_15: z.number().int().nullable(),
  cs_diff_at_15: z.number().int().nullable(),
  xp_diff_at_15: z.number().int().nullable(),
});

export type LaneResultLakeRow = z.infer<typeof LaneResultLakeRowSchema>;

export const LANE_RESULT_LAKE_COLUMNS: Record<
  keyof LaneResultLakeRow,
  DuckDbColumnType
> = {
  match_id: "VARCHAR",
  month: "VARCHAR",
  derived_at: "TIMESTAMP",
  game_created_at: "TIMESTAMP",
  queue_id: "INTEGER",
  puuid: "VARCHAR",
  participant_id: "INTEGER",
  team_id: "INTEGER",
  role: "VARCHAR",
  champion_id: "INTEGER",
  opponent_participant_id: "INTEGER",
  opponent_puuid: "VARCHAR",
  opponent_champion_id: "INTEGER",
  win: "BOOLEAN",
  has_timeline: "BOOLEAN",
  checkpoint_timestamp_ms: "BIGINT",
  gold_diff_at_15: "INTEGER",
  cs_diff_at_15: "INTEGER",
  xp_diff_at_15: "INTEGER",
};

/** A row as a lake read returns it: DuckDB integers, timestamps as epoch ms. */
export const LaneResultReadRowSchema = LaneResultLakeRowSchema.omit({
  derived_at: true,
  game_created_at: true,
}).extend({
  game_created_ms: LakeIntSchema,
  queue_id: LakeIntSchema,
  participant_id: LakeIntSchema,
  team_id: LakeIntSchema,
  champion_id: LakeIntSchema,
  opponent_participant_id: LakeIntSchema,
  opponent_champion_id: LakeIntSchema,
  checkpoint_timestamp_ms: LakeIntSchema.nullable(),
  gold_diff_at_15: LakeIntSchema.nullable(),
  cs_diff_at_15: LakeIntSchema.nullable(),
  xp_diff_at_15: LakeIntSchema.nullable(),
});

export type LaneResultReadRow = z.infer<typeof LaneResultReadRowSchema>;

/** The columns a lane-result read selects, in the read row's shape. */
export const LANE_RESULT_READ_COLUMNS_SQL = [
  ...Object.keys(LaneResultReadRowSchema.shape).filter(
    (column) => column !== "game_created_ms",
  ),
  "epoch_ms(game_created_at)::BIGINT AS game_created_ms",
].join(", ");
