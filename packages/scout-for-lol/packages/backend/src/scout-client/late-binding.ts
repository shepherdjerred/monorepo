import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import configuration from "#src/configuration.ts";
import { finalizeAndPublishManagedCustomResult } from "#src/customs/riot-result-publication.ts";
import { prisma } from "#src/database/index.ts";
import { fetchTimelineForDuelProgression } from "#src/league/tasks/postmatch/match-report-standard.ts";
import {
  duelMatchNeedsTimeline,
  processDuelResult,
} from "#src/progression/duels/results.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";
import { readMatchPipelineStateV2 } from "#src/temporal/v2/match-reads.ts";

/**
 * Reconcile match stages whose answer changes when local evidence binds a game
 * after the ordinary per-match Workflow has already committed its observation.
 * The client outbox retries this whole call, and both projectors are idempotent.
 */
export async function reconcileProcessedClientBinding(
  riotMatchId: RiotMatchId,
): Promise<boolean> {
  const state = await readMatchPipelineStateV2({ riotMatchId });
  if (state.kind === "absent") return false;

  const context = await resolveScoutV2MatchContext(riotMatchId);
  await finalizeAndPublishManagedCustomResult(prisma, context.matchData);

  if (await duelMatchNeedsTimeline(context.matchData)) {
    const timeline = await fetchTimelineForDuelProgression(
      context.matchData,
      context.matchId,
      context.trackedPlayers,
    );
    await processDuelResult(
      context.matchData,
      timeline,
      configuration.environment,
    );
  }
  return true;
}
