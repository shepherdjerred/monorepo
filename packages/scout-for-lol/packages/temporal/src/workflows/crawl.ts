import {
  CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
  ScoutCrawlFrontierPruneInputSchema,
  ScoutParticipantCrawlInputSchema,
  type ScoutCrawlFrontierPruneInput,
  type ScoutCrawlFrontierPruneResult,
  type ScoutParticipantCrawlInput,
  type ScoutParticipantCrawlResult,
} from "#src/contracts.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import {
  crawlActivities,
  crawlMaintenanceActivities,
} from "./activity-options.ts";

/**
 * One participant-crawl tick, started every minute by a declarative Schedule
 * with overlap SKIP. The Activity decides everything (whether the crawl is
 * enabled, the day's match budget, which players to visit), so this Workflow
 * stays a single deterministic step and a disabled crawl costs one no-op
 * Activity a minute.
 */
export async function scoutParticipantCrawlWorkflow(
  rawInput: ScoutParticipantCrawlInput,
): Promise<ScoutParticipantCrawlResult> {
  const input = ScoutParticipantCrawlInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** crawling participants");
  return await crawlActivities(input.stage).runParticipantCrawl(input);
}

/**
 * Keeps the crawl's work queue bounded, started every 15 minutes by a
 * declarative Schedule with overlap SKIP. Each Activity call deletes one
 * bounded batch (the Activity owns the retention rules); the Workflow only
 * repeats it while batches come back full.
 */
export async function scoutCrawlFrontierPruneWorkflow(
  rawInput: ScoutCrawlFrontierPruneInput,
): Promise<ScoutCrawlFrontierPruneResult> {
  const input = ScoutCrawlFrontierPruneInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** pruning the crawl frontier");
  const activities = crawlMaintenanceActivities(input.stage);
  const total = { batches: 0, stale: 0, overflow: 0 };
  let more = true;
  while (more && total.batches < CRAWL_FRONTIER_PRUNE_MAX_BATCHES) {
    const batch = await activities.pruneCrawlFrontier(input);
    total.batches += 1;
    total.stale += batch.stale;
    total.overflow += batch.overflow;
    more = batch.more;
  }
  return { ...total, drained: !more };
}
