import {
  CachedLeaderboardSchema,
  type CachedLeaderboard,
  type CompetitionId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildCompetitionRankHistorySource,
  scalarParam,
  withLakeQueryRetry,
} from "#src/reports/duckdb/lake.ts";

const CompetitionRankHistoryRowSchema = z.object({
  calculated_ms: z.union([z.bigint(), z.number()]).transform(Number),
  player_id: z.union([z.bigint(), z.number()]).transform(Number),
  player_name: z.string(),
  score: z.number(),
  rank: z.union([z.bigint(), z.number()]).transform(Number),
});

/**
 * Read the disposable competition_rank_history materialization. Undefined
 * means the current lake predates this source, allowing the API migration
 * path to read authoritative S3 directly; an empty array is a valid built
 * source with no snapshots for this competition.
 */
export async function fetchCompetitionRankHistory(options: {
  competitionId: CompetitionId;
  lakeDir?: string;
}): Promise<CachedLeaderboard[] | undefined> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  return await withLakeQueryRetry(lakeDir, async (files) => {
    const source = buildCompetitionRankHistorySource(files, {
      sql: "competition_id = ?",
      params: [scalarParam(options.competitionId)],
    });
    if (source === undefined) {
      return;
    }
    return await withDuckDBConnection(async (session) => {
      const rows = await session.run(
        `SELECT epoch_ms(calculated_at)::BIGINT AS calculated_ms, player_id, player_name, score, rank FROM (${source.sql}) ORDER BY calculated_at ASC, rank ASC`,
        bindParams(session, source.params),
      );
      const snapshots = new Map<
        number,
        z.infer<typeof CompetitionRankHistoryRowSchema>[]
      >();
      for (const row of rows) {
        const parsed = CompetitionRankHistoryRowSchema.parse(row);
        const bucket = snapshots.get(parsed.calculated_ms) ?? [];
        bucket.push(parsed);
        snapshots.set(parsed.calculated_ms, bucket);
      }
      return [...snapshots.entries()].map(([calculatedMs, entries]) =>
        CachedLeaderboardSchema.parse({
          version: "v1",
          competitionId: options.competitionId,
          calculatedAt: new Date(calculatedMs).toISOString(),
          entries: entries.map((entry) => ({
            playerId: entry.player_id,
            playerName: entry.player_name,
            score: entry.score,
            rank: entry.rank,
          })),
        }),
      );
    });
  });
}
