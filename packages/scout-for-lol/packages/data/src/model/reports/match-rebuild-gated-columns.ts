/** UI-only match fields selected after a fingerprint-triggered full rebuild. */
export const MATCH_REBUILD_GATED_COLUMNS = [
  "summoner_spell_1_id",
  "summoner_spell_2_id",
  "primary_rune_style_id",
  "primary_rune_0_id",
  "primary_rune_1_id",
  "primary_rune_2_id",
  "primary_rune_3_id",
  "secondary_rune_style_id",
  "secondary_rune_0_id",
  "secondary_rune_1_id",
  "stat_perk_offense_id",
  "stat_perk_flex_id",
  "stat_perk_defense_id",
  "augment_1_id",
  "augment_2_id",
  "augment_3_id",
  "augment_4_id",
  "augment_5_id",
  "augment_6_id",
] as const;

/**
 * Columns the participant-kind migration added. Builds published before it
 * have no such columns, and a read that names a column its build lacks fails
 * outright, so no read names these until Beta and Prod have both published a
 * rebuild at the current schema fingerprint. The follow-up that removes the
 * predecessor-fingerprint allowance (backend `report-lake/schema.ts`) deletes
 * this list, which makes both columns ordinary reads and ScoutQL columns.
 */
export const MATCH_MIGRATION_GATED_COLUMNS = [
  "participant_kind",
  "coverage",
] as const;
