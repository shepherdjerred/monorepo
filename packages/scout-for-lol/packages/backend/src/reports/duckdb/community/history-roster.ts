import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { buildMatchIdsSource } from "#src/reports/duckdb/community/match-source.ts";
import {
  withLakePage,
  type LakePage,
} from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";

const LakeInt = z.union([z.number(), z.bigint()]).transform(Number);
const HistoryRosterRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  // NULL for an end-of-game record, which numbers no participant; its rows
  // keep a stable order by champion instead.
  participant_id: LakeInt.nullable(),
  team_id: LakeInt,
  champion_name: z.string(),
  riot_id_game_name: z.string().nullable(),
  riot_id_tagline: z.string(),
});

/** Match IDs originate from an already-authorized and bounded history page. */
export async function readHistoryRosters(
  page: LakePage,
  options: { matchIds: RiotMatchId[] },
) {
  const source = buildMatchIdsSource(page.files, options.matchIds);
  if (source === undefined) return [];
  const rows = await page.session.run(
    `SELECT match_id, participant_id, team_id, champion_name, riot_id_game_name, riot_id_tagline ` +
      `FROM (${source.sql}) ORDER BY match_id, team_id, participant_id, champion_name`,
    bindParams(page.session, source.params),
  );
  return rows.map((row) => HistoryRosterRowSchema.parse(row));
}

export async function fetchHistoryRosters(options: {
  matchIds: RiotMatchId[];
  lakeDir?: string;
}) {
  return options.matchIds.length === 0
    ? []
    : await withLakePage(
        options.lakeDir,
        async (page) => await readHistoryRosters(page, options),
      );
}
