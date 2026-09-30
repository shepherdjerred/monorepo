import { z } from "zod";
import { LOADOUT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  withLakeQueryRetry,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const MatchLoadoutRowSchema = z.object({
  match_id: z.string(),
  game_duration_seconds: LakeIntSchema,
  puuid: z.string(),
  participant_id: LakeIntSchema,
  champion_id: LakeIntSchema,
  champion_name: z.string(),
  item0: LakeIntSchema.nullable(),
  item1: LakeIntSchema.nullable(),
  item2: LakeIntSchema.nullable(),
  item3: LakeIntSchema.nullable(),
  item4: LakeIntSchema.nullable(),
  item5: LakeIntSchema.nullable(),
  item6: LakeIntSchema.nullable(),
  summoner1_id: LakeIntSchema.nullable(),
  summoner2_id: LakeIntSchema.nullable(),
  perk_primary_style: LakeIntSchema.nullable(),
  perk_sub_style: LakeIntSchema.nullable(),
  perk0: LakeIntSchema.nullable(),
  perk1: LakeIntSchema.nullable(),
  perk2: LakeIntSchema.nullable(),
  perk3: LakeIntSchema.nullable(),
  perk4: LakeIntSchema.nullable(),
  perk5: LakeIntSchema.nullable(),
  stat_perk_offense: LakeIntSchema.nullable(),
  stat_perk_flex: LakeIntSchema.nullable(),
  stat_perk_defense: LakeIntSchema.nullable(),
});

export type LakeMatchLoadoutRow = z.infer<typeof MatchLoadoutRowSchema>;

/** Read the participant and loadout columns needed by an Explore card. */
export async function fetchMatchLoadoutRows(options: {
  matchId: string;
  abortSignal?: AbortSignal | undefined;
  lakeDir?: string;
}): Promise<LakeMatchLoadoutRow[]> {
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const source = buildMatchesSource(
        files,
        { sql: "match_id = ?", params: [scalarParam(options.matchId)] },
        LOADOUT_COLUMNS,
      );
      if (source === undefined) return [];
      const rows = await withDuckDBConnection(
        async (session) =>
          await session.run(
            `SELECT match_id, game_duration_seconds, puuid, participant_id, champion_id, champion_name, ` +
              `item0, item1, item2, item3, item4, item5, item6, ` +
              `summoner1_id, summoner2_id, perk_primary_style, perk_sub_style, ` +
              `perk0, perk1, perk2, perk3, perk4, perk5, ` +
              `stat_perk_offense, stat_perk_flex, stat_perk_defense FROM (${source.sql}) ` +
              `ORDER BY participant_id`,
            bindParams(session, source.params),
          ),
        options.abortSignal === undefined
          ? {}
          : { abortSignal: options.abortSignal },
      );
      return rows.map((row) => MatchLoadoutRowSchema.parse(row));
    },
  );
}
