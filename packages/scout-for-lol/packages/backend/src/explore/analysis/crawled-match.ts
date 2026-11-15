import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { ALL_POPULATION } from "#src/reports/duckdb/lake/all-population.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchDimensionSource,
  scalarParam,
  withLakeQueryRetry,
} from "#src/reports/duckdb/lake.ts";

/**
 * Whether a game is known to the lake only through the participant crawl.
 *
 * A global query can return a crawled match id, and the model then asks to
 * review it. The crawl keeps scoreboard rows and a reduced timeline, never the
 * Match-V5 document or full timeline a review reads, so the review answers
 * with why it cannot, instead of the "no stored match document" a stray id
 * gets.
 */
export async function isCrawlOnlyMatch(input: {
  matchId: RiotMatchId;
  lakeDir?: string | undefined;
  abortSignal?: AbortSignal | undefined;
}): Promise<boolean> {
  return await withLakeQueryRetry(
    input.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const source = buildMatchDimensionSource(
        files,
        { sql: "match_id = ?", params: [scalarParam(input.matchId)] },
        { population: ALL_POPULATION, provenance: true },
      );
      if (source === undefined) return false;
      const rows = await withDuckDBConnection(
        async (session) =>
          await session.run(
            `SELECT count(*) FILTER (WHERE provenance = 'crawl') AS crawled FROM (${source.sql})`,
            bindParams(session, source.params),
          ),
        input.abortSignal === undefined
          ? {}
          : { abortSignal: input.abortSignal },
      );
      const [row] = rows;
      return (
        z
          .object({ crawled: z.union([z.bigint(), z.number()]) })
          .transform((parsed) => Number(parsed.crawled))
          .parse(row) > 0
      );
    },
  );
}

/** What `review_match` answers for a crawled game. */
export const CRAWLED_MATCH_REVIEW_REFUSAL = {
  ok: false as const,
  message:
    "Scout has no stored match document for this game: it comes from Scout's match crawl, which keeps each player's scoreboard stats for global questions but not the match or timeline documents a review reads. Answer from run_report_query results for this match_id instead.",
};
