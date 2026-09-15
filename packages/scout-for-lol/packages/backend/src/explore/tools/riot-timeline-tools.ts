import { tool } from "ai";
import { z } from "zod";
import { MatchIdSchema } from "@scout-for-lol/data";
import { ScoutExploreTimelineResultSchema } from "@scout-for-lol/temporal";
import configuration from "#src/configuration.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutExploreTimeline } from "#src/temporal/starts.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

const ACQUISITION_BUCKET_MS = 10 * 60 * 1000;

export function invalidTimelineMatchIds(
  matchIds: readonly string[],
  eligible: ReadonlySet<string>,
): string[] {
  return matchIds.filter((matchId) => !eligible.has(matchId));
}

export function createRiotTimelineExploreTools(input: {
  eligibleMatchIds: () => ReadonlySet<string>;
  track: ToolTracker;
}) {
  return {
    acquire_match_timelines: tool({
      description:
        "Fetch and permanently add timelines for up to 10 match IDs from the most recent successful ScoutQL query. Use only when a timeline analysis needs data that coverage inspection shows is missing. Load riot-history first.",
      inputSchema: z
        .object({ matchIds: z.array(MatchIdSchema).min(1).max(10) })
        .strict(),
      outputSchema: ScoutExploreTimelineResultSchema.extend({
        ok: z.boolean(),
        message: z.string(),
      }).strict(),
      execute: ({ matchIds }) =>
        input.track("acquire_match_timelines", async () => {
          const eligible = input.eligibleMatchIds();
          const disallowed = invalidTimelineMatchIds(matchIds, eligible);
          if (disallowed.length > 0) {
            return {
              ok: false,
              requested: matchIds.length,
              alreadyAvailable: 0,
              ingested: 0,
              unavailable: disallowed.length,
              message:
                "Timeline acquisition is limited to match IDs returned by the most recent ScoutQL query. Run a query that selects the intended matches first.",
            };
          }
          const supervisor = currentScoutTemporalSupervisor();
          if (supervisor === undefined) {
            throw new Error("Temporal is unavailable for timeline acquisition");
          }
          const handle = await startScoutExploreTimeline(supervisor.client(), {
            stage: configuration.environment,
            matchIds,
            acquisitionBucket: Math.floor(Date.now() / ACQUISITION_BUCKET_MS),
          });
          const result = ScoutExploreTimelineResultSchema.parse(
            await handle.result(),
          );
          return {
            ok: true,
            ...result,
            message: `${(result.alreadyAvailable + result.ingested).toString()} of ${result.requested.toString()} requested timelines are ready (${result.alreadyAvailable.toString()} already present, ${result.ingested.toString()} newly fetched).`,
          };
        }),
    }),
  };
}
