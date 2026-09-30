import { z } from "zod";
import { withMatchIdsSource } from "#src/reports/duckdb/community/match-source.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";

const MatchSupportRowSchema = z.object({
  match_id: z.string(),
  queue_id: z.number(),
  game_mode: z.string(),
});

export async function fetchMatchSupport(options: {
  matchIds: string[];
  abortSignal?: AbortSignal | undefined;
  lakeDir?: string | undefined;
}): Promise<
  readonly { match_id: string; queue_id: number; game_mode: string }[]
> {
  return await withMatchIdsSource(
    options.matchIds,
    options.lakeDir,
    async (source) => {
      if (source === undefined) return [];
      return await withDuckDBConnection(
        async (session) => {
          const rows = await session.run(
            `SELECT DISTINCT match_id, queue_id, game_mode FROM (${source.sql})`,
            bindParams(session, source.params),
          );
          return rows.map((row) => MatchSupportRowSchema.parse(row));
        },
        options.abortSignal === undefined
          ? {}
          : { abortSignal: options.abortSignal },
      );
    },
  );
}
