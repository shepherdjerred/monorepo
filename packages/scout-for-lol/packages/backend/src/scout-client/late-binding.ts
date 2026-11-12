import configuration from "#src/configuration.ts";
import { finalizeManagedCustomResult } from "#src/customs/riot-results.ts";
import { prisma } from "#src/database/index.ts";
import { matchEffectsAllowed } from "#src/evidence/admission.ts";
import { fetchTimelineForDuelProgression } from "#src/league/tasks/postmatch/match-report-standard.ts";
import {
  duelMatchNeedsTimeline,
  processDuelResult,
} from "#src/progression/duels/results.ts";
import { readLegacyMatchCompletion } from "#src/temporal/match/legacy-completion.ts";
import { resolveScoutMatchContext } from "#src/temporal/match/match-context.ts";
import { readMatchPipelineState } from "#src/temporal/match/match-reads.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutMatchPipelineStateResult } from "@scout-for-lol/temporal/activity-contracts";
import {
  SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_MATCH_RECEIPT_KINDS,
  type ScoutMatchPhase,
} from "@scout-for-lol/temporal/match-receipts";

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
 * The match Workflow has not yet committed the stages a late binding depends
 * on. This is the designed retry signal, not a failure: callers answer it with
 * a retryable outcome and never report it as an error.
 */
export class ClientBindingReconciliationPending extends Error {
  override readonly name = "ClientBindingReconciliationPending";

  constructor(readonly riotMatchId: RiotMatchId) {
    super(
      `Match pipeline ${riotMatchId} is still applying binding-dependent stages; retry reconciliation`,
    );
  }
}

/**
 * Reconcile match stages whose answer changes when local evidence binds a game
 * after the ordinary per-match Workflow has already committed its observation.
 * The client outbox retries this whole call, and both projectors are idempotent.
 *
 * @throws {ClientBindingReconciliationPending} while the match Workflow is
 * still applying binding-dependent stages.
 */
export async function reconcileProcessedClientBinding(
  riotMatchId: RiotMatchId,
): Promise<boolean> {
  const state = await readMatchPipelineState({ riotMatchId });
  if (state.kind !== "present") return false;
  if (!(await matchEffectsAllowed(riotMatchId))) return true;
  if (
    state.state.receiptKinds.includes(SCOUT_CLIENT_MATCH_TERMINAL_RECEIPT_KIND)
  ) {
    // The dispatcher persisted this operator-review outcome before advancing.
    // A client retry can acknowledge it without resubmitting the same terminal
    // match forever or blocking newer observations in the outbox.
    return false;
  }
  let stagesComplete = clientBindingStagesAreComplete(state);
  if (state.state.owner.kind === "legacy-v1") {
    // The retired v1 pipeline will never touch it again; see
    // `readLegacyMatchCompletion` for why that answers complete.
    const legacyCompletion = await readLegacyMatchCompletion({
      stage: configuration.environment,
      riotMatchId,
    });
    stagesComplete = legacyCompletion.completed;
  }
  if (!stagesComplete) {
    throw new ClientBindingReconciliationPending(riotMatchId);
  }

  const context = await resolveScoutMatchContext(riotMatchId);
  await finalizeManagedCustomResult(
    prisma,
    context.matchData,
    context.matchDataSource,
  );
  if (state.state.policy !== "FULL") return true;

  if (await duelMatchNeedsTimeline(context.matchData)) {
    const timeline = await fetchTimelineForDuelProgression(
      context.matchData,
      context.riotMatchId,
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
