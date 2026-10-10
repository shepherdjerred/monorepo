import { isCancellation, log, patched, startChild } from "@temporalio/workflow";
import {
  ApplicationFailure,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/common";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import type { ScoutPrematchGameRef } from "#src/pipeline-contracts.ts";
import {
  scoutPrematchDiscoveryInputCodec,
  scoutPrematchDiscoveryResultCodec,
  scoutPrematchGameInputCodec,
  scoutPrematchGameResultCodec,
  type ScoutPrematchDiscoveryInputEnvelope,
  type ScoutPrematchDiscoveryResultEnvelope,
  type ScoutPrematchGameInputEnvelope,
  type ScoutPrematchGameResultEnvelope,
} from "#src/workflow-contracts.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutPrematchGameWorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { realtimePipelineActivities } from "./activity-options.ts";
import { planMatchFanOutChildren } from "./match-fan-out.ts";
import { startMatchFanOutChildren } from "./match.ts";
import { issuedWorkflowType } from "./generation-rename.ts";

/**
 * Prematch discovery, V2.
 *
 * Polls spectator state for tracked accounts and starts one
 * `scoutPrematchGameWorkflow` per live game. The child carries a game
 * REFERENCE, never the spectator payload: the payload is large, is already
 * destined for the object store, and would otherwise be copied into a
 * Workflow history that keeps it forever.
 *
 * ## Why this one does not wait for its children
 *
 * Post-match discovery awaits each child in turn because bounded Dare plans
 * are ordered by match end time, so a later match must not settle while an
 * earlier one is still being processed. Live games have no such chronology —
 * two games starting a second apart are independent — and only one poll runs
 * per stage at a time. Waiting would make the next poll wait on the slowest
 * game, and a game-start notification that arrives after the game is worth
 * nothing. Children are therefore started and abandoned.
 *
 * ## One poll at a time
 *
 * The `prematch-poll` Schedule starts this Workflow directly, every 30
 * seconds, and each action takes the Schedule's own per-action Workflow ID.
 * What keeps two polls from overlapping is the Schedule's `SKIP` overlap
 * policy, not the ID: a poll that outlives its interval makes the Schedule
 * drop the tick behind it. A missed tick is not caught up later than a
 * minute, because a late poll is worth nothing to a game-start notification.
 *
 * ## Maintenance runs last
 *
 * After the children are started, the poll runs the stage's prematch
 * maintenance sweeps in one realtime Activity. They used to ride v1's
 * `pollRealtime`; this poll is now the only thing that runs every 30 seconds
 * per stage, so it carries them. They come after detection so a slow sweep
 * never delays a game-start announcement.
 */
export async function scoutPrematchDiscoveryWorkflow(
  rawInput: ScoutPrematchDiscoveryInputEnvelope,
): Promise<ScoutPrematchDiscoveryResultEnvelope> {
  const input = scoutPrematchDiscoveryInputCodec.parse(rawInput);
  setWorkflowPhase("**Phase:** discovering live games");
  const scan = await realtimePipelineActivities(
    input.stage,
  ).discoverPrematchGames(input);

  let childrenStarted = 0;
  for (const gameRef of scan.games) {
    setWorkflowPhase(
      `**Phase:** starting prematch game \`${gameRef.platform}_${gameRef.gameId}\``,
    );
    if (await startPrematchGameChild(input.stage, gameRef)) {
      childrenStarted += 1;
    }
  }

  // Gated, although it is appended at the end. Closed discovery histories are
  // retained for the namespace's 30-day retention and replayed against a
  // candidate bundle before promotion, and one recorded before the tail
  // completed right after its last child start, so an unconditional Activity
  // there would fail that replay. Retire with `deprecatePatch` once no history
  // predating it is retained.
  if (patched(SCOUT_PREMATCH_MAINTENANCE_PATCH)) {
    setWorkflowPhase("**Phase:** running prematch maintenance");
    await realtimePipelineActivities(input.stage).runPrematchMaintenance({
      stage: input.stage,
    });
  }

  return scoutPrematchDiscoveryResultCodec.serialize({
    status: "completed",
    discovered: scan.games.length,
    childrenStarted,
    complete: scan.complete,
  });
}

/**
 * Start one live game's child, or report that its ID is already taken.
 *
 * A taken ID is the ORDINARY answer here, not a fault. The same game surfaces
 * on every poll for as long as it is live, and `scoutPrematchGameWorkflowId`
 * deliberately drops the puuid so every tracked account in one game computes
 * one ID. `ALLOW_DUPLICATE_FAILED_ONLY` then does the whole dedup: a running
 * or completed child refuses the start, while a FAILED one is replaced, so a
 * game whose capture died is retried by the next poll without a sweep.
 *
 * Unlike post-match discovery, a refused start does not stop the run. There is
 * no ordering to protect, and stopping would strand every game discovered
 * after the one that happens to already be in flight.
 */
async function startPrematchGameChild(
  stage: ScoutStage,
  gameRef: ScoutPrematchGameRef,
): Promise<boolean> {
  try {
    await startChild<typeof scoutPrematchGameWorkflow>(
      issuedWorkflowType(SCOUT_WORKFLOW_NAMES.prematchGame),
      {
        workflowId: scoutPrematchGameWorkflowId(stage, gameRef),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [scoutPrematchGameInputCodec.serialize({ stage, gameRef })],
      },
    );
    return true;
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
    throw error;
  }
}

/**
 * One live game, V2.
 *
 * Archives the spectator snapshot, receipts it, then fans out the
 * game-starting notifications. The snapshot is keyed by the match id Riot will
 * later assign — `scoutPrematchGameMatchId` composes it from the platform
 * and game id the reference already carries — so the prematch snapshot, the
 * eventual match payload and its timeline all land in one receipt scope.
 *
 * Several tracked accounts can be in the same game, and they are the same
 * snapshot. The Workflow ID drops the puuid for exactly that reason, so the
 * duplicates collapse instead of racing.
 *
 * ## Why there is no resume read
 *
 * The per-match core opens with `readMatchPipelineState` because it has four
 * phases with separate durable effects to skip past. This has one: capture.
 * There is also nothing for such a read to answer — the pipeline-state
 * aggregate hangs off `MatchObservation`, and a live game has not been
 * observed yet by definition. The replay gate therefore lives inside
 * `archivePrematchSnapshot`, which reads its own `raw-archive-prematch` and
 * `lake-staging-prematch` receipts before writing either, exactly as
 * `archiveMatchArtifacts` does. A run killed anywhere re-enters one
 * idempotent Activity.
 *
 * The fan-out is planned after the capture for the same reason the per-match
 * core plans after its commit: a notification is a promise about a fact, and a
 * child started before the snapshot was durable could announce a game whose
 * record the pipeline then failed to keep.
 */
export async function scoutPrematchGameWorkflow(
  rawInput: ScoutPrematchGameInputEnvelope,
): Promise<ScoutPrematchGameResultEnvelope> {
  const input = scoutPrematchGameInputCodec.parse(rawInput);
  const activities = realtimePipelineActivities(input.stage);

  setWorkflowPhase("**Phase:** archiving the prematch snapshot");
  const archive = await activities.archivePrematchSnapshot(input);
  const riotMatchId = archive.riotMatchId;

  setWorkflowPhase("**Phase:** planning the prematch fan-out");
  const plan = await activities.planPrematchFanOut({
    stage: input.stage,
    riotMatchId,
  });
  if (plan.lakeProjection) {
    // A prematch run has no lake child to start and no field to report one in:
    // the snapshot's lake rows are staged by `archivePrematchSnapshot`
    // itself, and `scoutLakeProjectionWorkflow` projects the MatchV5 payload,
    // which does not exist while the game is still being played. A plan that
    // asked for one is a broken contract, not something to drop silently.
    throw ApplicationFailure.nonRetryable(
      `Prematch fan-out for ${riotMatchId} asked for a lake projection, which the prematch path does not own`,
      "BrokenFanOutPlan",
    );
  }
  const children = planMatchFanOutChildren({
    stage: input.stage,
    riotMatchId,
    plan,
  });
  // Nothing captured AND nothing to announce means the game was already over
  // when this run reached the spectator endpoint. Saying "completed" would
  // claim a snapshot exists.
  const observedSomething =
    archive.artifacts.length > 0 || plan.notificationIntentKeys.length > 0;

  // Gated, because both are INSERTED commands. A history recorded before
  // this change completed straight after `planPrematchFanOut`; replaying it
  // against an unconditional markets Activity or child start would be
  // nondeterminism. The old branch starts nothing and opens nothing, which is
  // exactly what that generation did. Retire with `deprecatePatch` once no
  // execution predating it can still replay.
  let notifications = 0;
  if (patched(SCOUT_PREMATCH_DELIVERY_PATCH)) {
    if (observedSomething) {
      await openGameMarkets(activities, {
        stage: input.stage,
        riotMatchId,
      });
    }
    const started = await startMatchFanOutChildren(input.stage, children);
    notifications = started.notifications;
  }
  setWorkflowPhase(
    `**Phase:** planned ${String(children.length)} notification children, started ${String(notifications)}`,
  );

  return scoutPrematchGameResultCodec.serialize({
    status: observedSomething ? "completed" : "no-op",
    riotMatchId,
    receiptKinds: archive.artifacts.map((artifact) => artifact.receipt.kind),
    // Counted from the starts that took, never from the plan: an ID already
    // in use means some execution is already driving that intent.
    childrenStarted: { notifications },
  });
}

/**
 * The patch that gives the per-game core its markets and its notification
 * children. Recorded histories name this id; never rename it.
 */
export const SCOUT_PREMATCH_DELIVERY_PATCH = "scout-v2-prematch-delivery";

/**
 * The patch that gives discovery its maintenance tail. Recorded histories
 * name this id; never rename it.
 */
export const SCOUT_PREMATCH_MAINTENANCE_PATCH = "scout-v2-prematch-maintenance";

/**
 * Open this game's Bryan Bucks markets before any announcement is sent.
 *
 * Before, because v1 renders the buttons into the message it sends and the V2
 * message is built from the pool rows this writes. A failure here does NOT
 * stop the announcement: it has had its Activity retries, it stays visible in
 * this history as a failed Activity, and the game is announced without a
 * market — v1's promise that a betting bug never takes the loading screen
 * down with it. A cancellation is still the caller's decision.
 */
async function openGameMarkets(
  activities: ReturnType<typeof realtimePipelineActivities>,
  ref: { stage: ScoutStage; riotMatchId: RiotMatchId },
): Promise<void> {
  setWorkflowPhase("**Phase:** opening the Bryan Bucks markets");
  try {
    await activities.openPrematchMarkets(ref);
  } catch (error) {
    if (isCancellation(error)) throw error;
    log.error("Prematch markets failed; announcing without a market", {
      riotMatchId: ref.riotMatchId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
