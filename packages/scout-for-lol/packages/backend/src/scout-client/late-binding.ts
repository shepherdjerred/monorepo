import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  type ScoutV2MatchPhase,
} from "@scout-for-lol/temporal/match-receipts-v2";
import type { ScoutMatchPipelineStateV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { awardBucksForMatch } from "#src/betting/accounts/earnings.ts";
import configuration from "#src/configuration.ts";
import { finalizeAndPublishManagedCustomResult } from "#src/customs/riot-result-publication.ts";
import { prisma } from "#src/database/index.ts";
import { readLegacyMatchCompletionV2 } from "#src/league/tasks/postmatch/cursor-reconciliation.ts";
import { fetchTimelineForDuelProgression } from "#src/league/tasks/postmatch/match-report-standard.ts";
import {
  duelMatchNeedsTimeline,
  processDuelResult,
} from "#src/progression/duels/results.ts";
import {
  lateBindingEarningsCheckpointSink,
  mintStandingLateBindingEarningIntentsV2,
} from "#src/temporal/v2/match-effects.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";
import { readMatchPipelineStateV2 } from "#src/temporal/v2/match-reads.ts";

const ALWAYS_REQUIRED_BINDING_PHASES = [
  "tournament",
] as const satisfies readonly ScoutV2MatchPhase[];
const FULL_BINDING_PHASES = [
  "settlement",
  "progression",
] as const satisfies readonly ScoutV2MatchPhase[];
export function clientBindingStagesAreComplete(
  result: ScoutMatchPipelineStateV2Result,
): boolean {
  if (result.kind !== "present") return false;
  const receipts = new Set(result.state.receiptKinds);
  if (result.state.owner.kind !== "temporal-v2") return false;
  const required = [
    ...ALWAYS_REQUIRED_BINDING_PHASES,
    ...(result.state.policy === "FULL" ? FULL_BINDING_PHASES : []),
  ];
  return required.every((phase) =>
    receipts.has(SCOUT_V2_MATCH_RECEIPT_KINDS[phase]),
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
  const state = await readMatchPipelineStateV2({ riotMatchId });
  if (state.kind !== "present") return false;
  if (
    state.state.receiptKinds.includes(
      SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
    )
  ) {
    // The dispatcher persisted this operator-review outcome before advancing.
    // A client retry can acknowledge it without resubmitting the same terminal
    // match forever or blocking newer observations in the outbox.
    return false;
  }
  let stagesComplete = clientBindingStagesAreComplete(state);
  if (state.state.owner.kind === "legacy-v1") {
    const legacyCompletion = await readLegacyMatchCompletionV2({
      stage: configuration.environment,
      riotMatchId,
    });
    stagesComplete = legacyCompletion.completed;
  }
  if (!stagesComplete) {
    throw new Error(
      `Match pipeline ${riotMatchId} is still applying binding-dependent stages; retry reconciliation`,
    );
  }

  const context = await resolveScoutV2MatchContext(riotMatchId);
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
  await mintStandingLateBindingEarningIntentsV2({
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
