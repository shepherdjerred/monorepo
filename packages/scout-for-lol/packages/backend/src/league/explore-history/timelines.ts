import { z } from "zod";
import { MatchIdSchema, PlatformRouteSchema } from "@scout-for-lol/data";
import {
  ScoutExploreTimelineInputSchema,
  ScoutExploreTimelineResultSchema,
  type ScoutExploreTimelineInput,
  type ScoutExploreTimelineResult,
} from "@scout-for-lol/temporal";
import { fetchMatchTimeline } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { recordTimelineForReportStore } from "#src/report-store/live-ingest.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  listParam,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";
import { runSettledWorkers } from "#src/league/explore-history/worker-pool.ts";

const MAX_PARALLEL_TIMELINE_READS = 3;
const MatchRefRowSchema = z.object({
  match_id: MatchIdSchema,
  platform_id: PlatformRouteSchema,
  game_creation_ms: z.union([z.bigint(), z.number()]).transform(Number),
});
const CoverageRowSchema = z.object({ match_id: MatchIdSchema });

async function resolveMatchRefs(matchIds: string[]): Promise<{
  refs: z.infer<typeof MatchRefRowSchema>[];
  complete: Set<string>;
}> {
  const files = await resolveLakeFiles(resolveLakeDir());
  const predicate = {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(matchIds)],
  };
  const matchSource = buildMatchesSource(files, predicate);
  if (matchSource === undefined) return { refs: [], complete: new Set() };
  const coverageSource = buildTimelineCoverageSource(files, predicate);
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT match_id, any_value(platform_id) AS platform_id, MIN(epoch_ms(game_creation_at)) AS game_creation_ms FROM (${matchSource.sql}) GROUP BY match_id`,
      bindParams(session, matchSource.params),
    );
    const coverageRows =
      coverageSource === undefined
        ? []
        : await session.run(
            `SELECT DISTINCT match_id FROM (${coverageSource.sql}) WHERE coverage_state = 'complete'`,
            bindParams(session, coverageSource.params),
          );
    return {
      refs: rows.map((row) => MatchRefRowSchema.parse(row)),
      complete: new Set(
        coverageRows.map((row) => CoverageRowSchema.parse(row).match_id),
      ),
    };
  });
}

export async function importExploreTimelines(
  rawInput: ScoutExploreTimelineInput,
): Promise<ScoutExploreTimelineResult> {
  const input = ScoutExploreTimelineInputSchema.parse(rawInput);
  const { refs, complete } = await resolveMatchRefs(input.matchIds);
  const missing = refs.filter((ref) => !complete.has(ref.match_id));
  let nextIndex = 0;
  let ingested = 0;
  let unavailable = input.matchIds.length - refs.length;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const ref = missing[index];
      if (ref === undefined) return;
      const timeline = await fetchMatchTimeline(
        ref.match_id,
        ref.platform_id,
        "return_undefined_on_404",
      );
      if (timeline === undefined) {
        unavailable += 1;
        continue;
      }
      const staged = await recordTimelineForReportStore({
        timeline,
        source: "explore_on_demand",
        trackedPlayerAliases: [],
        gameCreatedAt: new Date(ref.game_creation_ms),
      });
      if (!staged) {
        throw new Error(`Explore timeline ${ref.match_id} was not staged`);
      }
      ingested += 1;
    }
  };
  await runSettledWorkers(
    Math.min(MAX_PARALLEL_TIMELINE_READS, missing.length),
    worker,
  );
  return ScoutExploreTimelineResultSchema.parse({
    requested: input.matchIds.length,
    alreadyAvailable: complete.size,
    ingested,
    unavailable,
  });
}
