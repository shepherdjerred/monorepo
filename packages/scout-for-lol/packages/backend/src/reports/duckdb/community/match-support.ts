import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import {
  buildMatchIdsSource,
  withMatchIdsSource,
} from "#src/reports/duckdb/community/match-source.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";

const MatchSupportRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  queue_id: z.number(),
  game_mode: z.string(),
});

type MatchSupportRow = {
  match_id: string;
  queue_id: number;
  game_mode: string;
};

/** The same read as {@link fetchMatchSupport}, on the caller's lake page. */
export async function readMatchSupport(
  page: LakePage,
  options: { matchIds: RiotMatchId[] },
): Promise<readonly MatchSupportRow[]> {
  const source = buildMatchIdsSource(page.files, options.matchIds);
  if (source === undefined) return [];
  const rows = await page.session.run(
    `SELECT DISTINCT match_id, queue_id, game_mode FROM (${source.sql})`,
    bindParams(page.session, source.params),
  );
  return rows.map((row) => MatchSupportRowSchema.parse(row));
}

export async function fetchMatchSupport(options: {
  matchIds: RiotMatchId[];
  abortSignal?: AbortSignal | undefined;
  lakeDir?: string | undefined;
}): Promise<readonly MatchSupportRow[]> {
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
