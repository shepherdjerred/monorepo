import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";

const LakeInt = z.union([z.bigint(), z.number()]).transform(Number);
const HistoryRosterRowSchema = z.object({
  match_id: z.string(),
  participant_id: LakeInt,
  team_id: LakeInt,
  champion_name: z.string(),
  riot_id_game_name: z.string().nullable(),
  riot_id_tagline: z.string(),
});

/** Match IDs originate from an already-authorized and bounded history page. */
export async function fetchHistoryRosters(options: {
  matchIds: string[];
  lakeDir?: string;
}) {
  if (options.matchIds.length === 0) return [];
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(options.matchIds)],
  });
  if (source === undefined) return [];
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT match_id, participant_id, team_id, champion_name, riot_id_game_name, riot_id_tagline ` +
        `FROM (${source.sql}) ORDER BY match_id, team_id, participant_id`,
      bindParams(session, source.params),
    );
    return rows.map((row) => HistoryRosterRowSchema.parse(row));
  });
}
