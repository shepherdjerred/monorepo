import { z } from "zod";
import {
  LeaguePuuidSchema,
  MatchIdSchema,
  platformToRegionalRoute,
} from "@scout-for-lol/data";
import {
  ScoutExploreHistoryInputSchema,
  ScoutExploreHistoryResultSchema,
  type ScoutExploreHistoryInput,
  type ScoutExploreHistoryResult,
} from "@scout-for-lol/temporal";
import { riotClient } from "#src/league/api/api.ts";
import { callRiotOrThrow } from "#src/league/api/riot-call.ts";
import { fetchInitialMatch } from "#src/league/initial-history/riot.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";
import { runSettledWorkers } from "#src/league/explore-history/worker-pool.ts";

const MAX_PARALLEL_MATCH_READS = 5;

const KnownMatchRowSchema = z.object({ match_id: MatchIdSchema });

async function fetchKnownMatchIds(matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const files = await resolveLakeFiles(resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  });
  if (source === undefined) return new Set();
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT DISTINCT match_id FROM (${source.sql})`,
      bindParams(session, source.params),
    );
    return new Set(rows.map((row) => KnownMatchRowSchema.parse(row).match_id));
  });
}

async function fetchRankedMatchIds(
  input: ScoutExploreHistoryInput,
): Promise<string[]> {
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  return await callRiotOrThrow(
    {
      source: "explore-on-demand-list",
      schema: z.array(MatchIdSchema).max(input.requestedMatches),
      context: { region: input.region },
      sentry: true,
    },
    () =>
      riotClient.match.list(
        puuid,
        platformToRegionalRoute(input.region),
        { count: input.requestedMatches, type: "ranked" },
        { maxRetries: 0 },
      ),
  );
}

/**
 * Fetch and permanently ingest the newest ranked games for one account.
 *
 * The shared Riot client owns rate limiting. This extra five-worker bound
 * prevents one Explore question from consuming every available in-process
 * request slot while still keeping a hundred-game acquisition interactive.
 */
export async function importExploreRankedHistory(
  rawInput: ScoutExploreHistoryInput,
): Promise<ScoutExploreHistoryResult> {
  const input = ScoutExploreHistoryInputSchema.parse(rawInput);
  const matchIds = await fetchRankedMatchIds(input);
  const knownMatchIds = await fetchKnownMatchIds(matchIds);
  const missingMatchIds = matchIds.filter(
    (matchId) => !knownMatchIds.has(matchId),
  );
  let nextIndex = 0;
  let ingested = 0;
  let skipped = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const matchId = missingMatchIds[index];
      if (matchId === undefined) return;
      const match = await fetchInitialMatch({
        matchId: MatchIdSchema.parse(matchId),
        region: input.region,
      });
      if (match === null) {
        skipped += 1;
        continue;
      }
      const stored = await recordMatchForReportStore({
        match,
        source: "explore_on_demand",
        trackedPlayerAliases: [],
      });
      if (!stored.stored || !stored.staged) {
        throw new Error(
          `Explore history match ${matchId} was not stored and staged`,
        );
      }
      ingested += 1;
    }
  };

  await runSettledWorkers(
    Math.min(MAX_PARALLEL_MATCH_READS, missingMatchIds.length),
    worker,
  );
  return ScoutExploreHistoryResultSchema.parse({
    requested: input.requestedMatches,
    found: matchIds.length,
    alreadyAvailable: knownMatchIds.size,
    ingested,
    skipped,
  });
}
