import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  buildPrematchSource,
  withLakeQueryRetry,
} from "#src/reports/duckdb/lake.ts";

const PrematchIdentityRowSchema = z.object({
  puuid: z.string(),
  riot_id: z.string(),
});

export type LakePrematchIdentityRow = z.infer<typeof PrematchIdentityRowSchema>;

/**
 * Distinct (puuid, riot_id) pairs from prematch observations — the
 * summoner-index backfill source. Returns [] before the first compaction
 * (fail-soft: the backfill is idempotent and re-runs on next startup).
 */
export async function fetchDistinctPrematchIdentities(
  options: { lakeDir?: string } = {},
): Promise<LakePrematchIdentityRow[]> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  return await withLakeQueryRetry(lakeDir, async (files) => {
    const source = buildPrematchSource(files, { sql: "", params: [] });
    if (source === undefined) return [];
    const sql = `SELECT DISTINCT puuid, riot_id FROM (${source.sql})`;
    return await withDuckDBConnection(async (session) => {
      const params = source.params.map((param) =>
        param.kind === "list" ? session.list(param.values) : param.value,
      );
      const rows = await session.run(sql, params);
      return rows.map((row) => PrematchIdentityRowSchema.parse(row));
    });
  });
}
