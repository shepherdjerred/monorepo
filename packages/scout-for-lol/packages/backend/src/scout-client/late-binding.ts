import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_MATCH_RECEIPT_KINDS,
  type ScoutMatchPhase,
} from "@scout-for-lol/temporal/match-receipts";
import type { ScoutMatchPipelineStateResult } from "@scout-for-lol/temporal/activity-contracts";
import { awardBucksForMatch } from "#src/betting/accounts/earnings.ts";
import configuration from "#src/configuration.ts";
import { finalizeAndPublishManagedCustomResult } from "#src/customs/riot-result-publication.ts";
import { prisma } from "#src/database/index.ts";
import { fetchTimelineForDuelProgression } from "#src/league/tasks/postmatch/match-report-standard.ts";
import {
  duelMatchNeedsTimeline,
  processDuelResult,
} from "#src/progression/duels/results.ts";
import {
  lateBindingEarningsCheckpointSink,
  mintStandingLateBindingEarningIntents,
} from "#src/temporal/match/match-effects.ts";
import { resolveScoutMatchContext } from "#src/temporal/match/match-context.ts";
import { readMatchPipelineState } from "#src/temporal/match/match-reads.ts";

const ALWAYS_REQUIRED_BINDING_PHASES = [
  "tournament",
] as const satisfies readonly ScoutMatchPhase[];
const FULL_BINDING_PHASES = [
  "settlement",
  "progression",
] as const satisfies readonly ScoutMatchPhase[];
export function clientBindingStagesAreComplete(
  result: ScoutMatchPipelineStateResult,
): boolean {
  if (result.kind !== "present") return false;
  const receipts = new Set(result.state.receiptKinds);
  if (result.state.owner.kind !== "temporal-v2") return false;
  const required = [
    ...ALWAYS_REQUIRED_BINDING_PHASES,
    ...(result.state.policy === "FULL" ? FULL_BINDING_PHASES : []),
  ];
  return required.every((phase) =>
    receipts.has(SCOUT_MATCH_RECEIPT_KINDS[phase]),
  );
}

/**
 * Reconcile match stages whose answer changes when local evidence binds a game
 * after the ordinary per-match Workflow has already committed its observation.
 * The client outbox retries this whole call, and both projectors are idempotent.
 */
export async function reconcileProcessedClientBinding(
  riotMatchId: RiotMatchId,
): Promise<boolean> {
  const state = await readMatchPipelineState({ riotMatchId });
  if (state.kind !== "present") return false;
  if (
    state.state.receiptKinds.includes(SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND)
  ) {
    // The dispatcher persisted this operator-review outcome before advancing.
    // A client retry can acknowledge it without resubmitting the same terminal
    // match forever or blocking newer observations in the outbox.
    return false;
  }
  // A match the retired v1 pipeline owned finished there: every v1 execution
  // has drained, so its binding-dependent stages are as complete as they will
  // ever be.
  const stagesComplete =
    state.state.owner.kind === "legacy-v1" ||
    clientBindingStagesAreComplete(state);
  if (!stagesComplete) {
    throw new Error(
      `Match pipeline ${riotMatchId} is still applying binding-dependent stages; retry reconciliation`,
    );
  }

  const context = await resolveScoutMatchContext(riotMatchId);
  await finalizeAndPublishManagedCustomResult(
    prisma,
    context.matchData,
    context.matchDataSource,
  );
  if (state.state.policy !== "FULL") return true;
  await awardBucksForMatch(
    context.matchData,
    prisma,
    lateBindingEarningsCheckpointSink(
      riotMatchId,
      state.state.deliveryMode === "live",
    ),
  );
  await mintStandingLateBindingEarningIntents({
    riotMatchId,
    gameCreation: context.matchData.info.gameCreation,
  });

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
