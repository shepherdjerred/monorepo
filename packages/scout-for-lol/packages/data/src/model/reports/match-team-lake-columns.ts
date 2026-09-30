import { z } from "zod";
import type { DuckDbColumnType } from "#src/model/reports/lake-columns.ts";

export const MatchTeamLakeRowSchema = z.object({
  match_id: z.string(),
  month: z.string(),
  team_id: z.number(),
  win: z.boolean(),
  baron_kills: z.number(),
  first_baron: z.boolean(),
  champion_kills: z.number(),
  first_champion_kill: z.boolean(),
  dragon_kills: z.number(),
  first_dragon: z.boolean(),
  inhibitor_kills: z.number(),
  first_inhibitor: z.boolean(),
  rift_herald_kills: z.number(),
  first_rift_herald: z.boolean(),
  tower_kills: z.number(),
  first_tower: z.boolean(),
  void_grub_kills: z.number().nullable(),
  first_void_grub: z.boolean().nullable(),
  atakhan_kills: z.number().nullable(),
  first_atakhan: z.boolean().nullable(),
  epic_monster_feat_state: z.number().nullable(),
  first_blood_feat_state: z.number().nullable(),
  first_turret_feat_state: z.number().nullable(),
});

export type MatchTeamLakeRow = z.infer<typeof MatchTeamLakeRowSchema>;

export const MatchTeamBanLakeRowSchema = z.object({
  match_id: z.string(),
  month: z.string(),
  team_id: z.number(),
  pick_turn: z.number(),
  champion_id: z.number(),
});

export type MatchTeamBanLakeRow = z.infer<typeof MatchTeamBanLakeRowSchema>;

export const MATCH_TEAM_LAKE_COLUMNS: Record<
  keyof MatchTeamLakeRow,
  DuckDbColumnType
> = {
  match_id: "VARCHAR",
  month: "VARCHAR",
  team_id: "INTEGER",
  win: "BOOLEAN",
  baron_kills: "INTEGER",
  first_baron: "BOOLEAN",
  champion_kills: "INTEGER",
  first_champion_kill: "BOOLEAN",
  dragon_kills: "INTEGER",
  first_dragon: "BOOLEAN",
  inhibitor_kills: "INTEGER",
  first_inhibitor: "BOOLEAN",
  rift_herald_kills: "INTEGER",
  first_rift_herald: "BOOLEAN",
  tower_kills: "INTEGER",
  first_tower: "BOOLEAN",
  void_grub_kills: "INTEGER",
  first_void_grub: "BOOLEAN",
  atakhan_kills: "INTEGER",
  first_atakhan: "BOOLEAN",
  epic_monster_feat_state: "INTEGER",
  first_blood_feat_state: "INTEGER",
  first_turret_feat_state: "INTEGER",
};

export const MATCH_TEAM_BAN_LAKE_COLUMNS: Record<
  keyof MatchTeamBanLakeRow,
  DuckDbColumnType
> = {
  match_id: "VARCHAR",
  month: "VARCHAR",
  team_id: "INTEGER",
  pick_turn: "INTEGER",
  champion_id: "INTEGER",
};
