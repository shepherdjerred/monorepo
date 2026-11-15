import {
  ScoutParticipantCrawlInputSchema,
  type ScoutParticipantCrawlInput,
  type ScoutParticipantCrawlResult,
} from "#src/contracts.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { crawlActivities } from "./activity-options.ts";

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
