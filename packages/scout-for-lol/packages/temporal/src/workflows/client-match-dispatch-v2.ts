import {
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  isCancellation,
  patched,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { ApplicationFailure } from "@temporalio/common";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ReceiptKind } from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutMatchPipelineStateV2Result } from "#src/activity-contracts-v2.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
} from "#src/match-receipts-v2.ts";
import {
  dispatchScoutClientMatchesV2Signal,
  scoutClientMatchDispatchCompletedV2Signal,
} from "#src/signals.ts";
import {
  ScoutClientMatchDispatchBatchV2Schema,
  ScoutClientMatchDispatchResultV2Schema,
  scoutClientMatchDispatchV2InputCodec,
  type ScoutClientMatchDispatchItemV2,
  type ScoutClientMatchDispatchOrderKeyV2,
  type ScoutClientMatchDispatchV2InputEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { realtimeV2Activities } from "./activity-options.ts";
import { processMatchAsChild } from "./match-v2.ts";

function compareClientDispatchItems(
  left: ScoutClientMatchDispatchItemV2,
  right: ScoutClientMatchDispatchItemV2,
): number {
  return (
    left.gameEndTimestamp - right.gameEndTimestamp ||
    left.riotMatchId.localeCompare(right.riotMatchId)
  );
}

function firstClientDispatchItem(
  pending: ReadonlyMap<RiotMatchId, ScoutClientMatchDispatchItemV2>,
): ScoutClientMatchDispatchItemV2 | undefined {
  return [...pending.values()].sort(compareClientDispatchItems)[0];
}

function clientDispatchOrderKey(
  match: ScoutClientMatchDispatchItemV2,
): ScoutClientMatchDispatchOrderKeyV2 {
  return {
    gameEndTimestamp: match.gameEndTimestamp,
    riotMatchId: match.riotMatchId,
  };
}

function compareClientDispatchItemToOrderKey(
  match: ScoutClientMatchDispatchItemV2,
  key: ScoutClientMatchDispatchOrderKeyV2,
): number {
  return (
    match.gameEndTimestamp - key.gameEndTimestamp ||
    match.riotMatchId.localeCompare(key.riotMatchId)
  );
}

function clientDispatchIsBehindWatermark(
  match: ScoutClientMatchDispatchItemV2,
  watermark: ScoutClientMatchDispatchOrderKeyV2,
): boolean {
  return (
    match.riotMatchId !== watermark.riotMatchId &&
    compareClientDispatchItemToOrderKey(match, watermark) < 0
  );
}

/**
 * Replay gate for exempting Riot discoveries from the late-arrival watermark.
 *
 * Histories recorded before this patch routed every item behind the watermark
 * to review, Riot discoveries included, and replaying them without a marker
 * keeps that decision. The long-running dispatcher reaches its first live
 * Workflow Task after deploy with `patched` answering true, so it adopts the
 * new routing without a restart. Retire with `deprecatePatch` once no
 * execution predating it can still replay.
 */
export const SCOUT_V2_DISPATCH_RIOT_BYPASSES_WATERMARK_PATCH =
  "scout-v2-dispatch-riot-bypasses-watermark";

/**
 * Whether Riot discovery vouches for this item.
 *
 * A discovery run always names itself as a completion target because it waits
 * for the acknowledgement; native ingress never does, because its HTTP outbox
 * retries instead. A merged item carrying any target was therefore discovered
 * by Riot too.
 */
function clientDispatchIsRiotDiscovery(
  match: ScoutClientMatchDispatchItemV2,
): boolean {
  return match.completionTargets.length > 0;
}

/**
 * Whether an item must go to late-arrival review instead of being processed.
 *
 * The watermark is a native-client guard: an offline-history sighting that
 * sorts behind work already started cannot be proven to be in order. Riot
 * discovery is ordered per account by that account's cursor and polls a
 * rotating subset of accounts, so it routinely hands over one account's older
 * match after another account's newer one. That crossing is the order v1
 * always settled in, and refusing it lost the match. Riot items therefore take
 * the ordinary in-order path. They still advance the watermark, which keeps
 * the client guard at least as strict as it was.
 */
function clientDispatchNeedsLateReview(
  match: ScoutClientMatchDispatchItemV2,
  watermark: ScoutClientMatchDispatchOrderKeyV2 | null,
): boolean {
  if (
    watermark === null ||
    !clientDispatchIsBehindWatermark(match, watermark)
  ) {
    return false;
  }
  // Evaluated only on the decision it gates, so a history that never met a
  // late Riot item records no marker.
  return !(
    clientDispatchIsRiotDiscovery(match) &&
    patched(SCOUT_V2_DISPATCH_RIOT_BYPASSES_WATERMARK_PATCH)
  );
}

/**
 * Merge repeated observations without allowing an offline-history sighting to
 * downgrade a live completion. Keeping the earliest ready time prevents a
 * lost HTTP response and outbox retry from extending the Riot-first window
 * forever.
 */
function mergeClientDispatchItem(
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  incoming: ScoutClientMatchDispatchItemV2,
): void {
  const existing = pending.get(incoming.riotMatchId);
  if (existing === undefined) {
    pending.set(incoming.riotMatchId, incoming);
    return;
  }
  const incomingIsLive = incoming.deliveryMode === "live";
  const completionTargets = new Map(
    [...existing.completionTargets, ...incoming.completionTargets].map(
      (target) => [`${target.workflowId}:${target.runId}`, target],
    ),
  );
  pending.set(incoming.riotMatchId, {
    riotMatchId: existing.riotMatchId,
    sourcePuuid: incomingIsLive ? incoming.sourcePuuid : existing.sourcePuuid,
    deliveryMode:
      incomingIsLive || existing.deliveryMode === "live"
        ? "live"
        : "silent-backfill",
    gameEndTimestamp: Math.min(
      existing.gameEndTimestamp,
      incoming.gameEndTimestamp,
    ),
    readyAt:
      Date.parse(existing.readyAt) <= Date.parse(incoming.readyAt)
        ? existing.readyAt
        : incoming.readyAt,
    completionTargets: [...completionTargets.values()],
  });
}

function nonRetryableFailureOf(error: unknown): ApplicationFailure | undefined {
  let candidate = error;
  while (candidate instanceof Error) {
    if (
      candidate instanceof ApplicationFailure &&
      candidate.nonRetryable === true
    ) {
      return candidate;
    }
    candidate = candidate.cause;
  }
  return undefined;
}

async function acknowledgeClientDispatch(
  match: ScoutClientMatchDispatchItemV2,
  result: {
    readonly outcome: "processed" | "already-complete" | "terminal-failure";
    readonly failureType?: string;
  },
): Promise<void> {
  const signal = ScoutClientMatchDispatchResultV2Schema.parse({
    riotMatchId: match.riotMatchId,
    ...result,
  });
  for (const target of match.completionTargets) {
    try {
      await getExternalWorkflowHandle(target.workflowId, target.runId).signal(
        scoutClientMatchDispatchCompletedV2Signal,
        signal,
      );
    } catch (error) {
      if (isCancellation(error)) throw error;
      // The exact requesting run may have been terminated after it signalled.
      // Its absence must not strand every later environment-wide match.
    }
  }
}

function clientMatchCoreIsComplete(
  result: ScoutMatchPipelineStateV2Result,
): boolean {
  if (result.kind !== "present") return false;
  const { state } = result;
  const receipts = new Set<ReceiptKind>(state.receiptKinds);
  if (state.owner.kind !== "temporal-v2") return false;
  const required = [
    SCOUT_V2_MATCH_RECEIPT_KINDS.archive,
    SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
    SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
    ...(state.policy === "FULL"
      ? [
          SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
          SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
        ]
      : []),
  ];
  return (
    required.every((kind) => receipts.has(kind)) &&
    state.trackedAccounts.cursorAdvanced === state.trackedAccounts.total
  );
}

function clientMatchIsTerminal(
  result: ScoutMatchPipelineStateV2Result,
): boolean {
  return (
    result.kind === "terminal" ||
    (result.kind === "present" &&
      result.state.receiptKinds.includes(
        SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
      ))
  );
}

/**
 * Wait for, start, and join one match core. A competing Riot discovery may
 * already own the deterministic child ID; in that case the dispatcher reads
 * the durable resume point until the chronological core is complete instead
 * of advancing to a later match while the earlier one is still settling.
 */
async function processClientMatchInOrder(
  stage: ScoutStage,
  match: ScoutClientMatchDispatchItemV2,
): Promise<"processed" | "already-complete"> {
  const activities = realtimeV2Activities(stage);
  for (;;) {
    const state = await activities.readMatchPipelineStateV2({
      stage,
      riotMatchId: match.riotMatchId,
    });
    if (clientMatchIsTerminal(state)) {
      throw ApplicationFailure.nonRetryable(
        `Match ${match.riotMatchId} is awaiting review after a terminal client dispatch`,
        "ClientMatchTerminalReview",
      );
    }
    if (clientMatchCoreIsComplete(state)) return "already-complete";
    if (state.kind === "present" && state.state.owner.kind === "legacy-v1") {
      const completion = await activities.readLegacyMatchCompletionV2({
        stage,
        riotMatchId: match.riotMatchId,
      });
      if (completion.completed) return "already-complete";
      setWorkflowPhase(
        `**Phase:** waiting for legacy ingestion of \`${match.riotMatchId}\` to finish its effects and cursors`,
      );
      await sleep("5 seconds");
      continue;
    }
    if (await processMatchAsChild(stage, match)) return "processed";
    setWorkflowPhase(
      `**Phase:** waiting for the existing match pipeline for \`${match.riotMatchId}\``,
    );
    await sleep("5 seconds");
  }
}

async function waitForClientDispatchReady(
  pending: ReadonlyMap<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  next: ScoutClientMatchDispatchItemV2,
): Promise<boolean> {
  const remainingMs = Date.parse(next.readyAt) - Date.now();
  if (remainingMs <= 0) return true;
  setWorkflowPhase(
    `**Phase:** preserving Riot's first-refusal window for \`${next.riotMatchId}\``,
  );
  const waitingFor = next.riotMatchId;
  const waitingUntil = next.readyAt;
  await condition(() => {
    const first = firstClientDispatchItem(pending);
    return first?.riotMatchId !== waitingFor || first.readyAt !== waitingUntil;
  }, remainingMs);
  return false;
}

async function recordClientMatchTerminalUntilDurable(
  stage: ScoutStage,
  match: ScoutClientMatchDispatchItemV2,
): Promise<void> {
  const activities = realtimeV2Activities(stage);
  for (;;) {
    try {
      await activities.recordClientMatchTerminalV2({
        stage,
        riotMatchId: match.riotMatchId,
      });
      return;
    } catch (error) {
      if (isCancellation(error)) throw error;
      setWorkflowPhase(
        `**Phase:** terminal marker for \`${match.riotMatchId}\` is not durable yet; preserving the queue before retry`,
      );
      // The activity has exhausted its bounded retry policy. Stay inside a
      // durable marker loop so neither this match nor those behind it can be
      // abandoned, and do not start another run of the terminal child.
      await sleep("10 seconds");
    }
  }
}

async function processReadyClientDispatch(
  stage: ScoutStage,
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  next: ScoutClientMatchDispatchItemV2,
): Promise<void> {
  setWorkflowPhase(
    `**Phase:** processing shared match \`${next.riotMatchId}\` in completion order`,
  );
  try {
    const outcome = await processClientMatchInOrder(stage, next);
    const completed = pending.get(next.riotMatchId) ?? next;
    pending.delete(next.riotMatchId);
    await acknowledgeClientDispatch(completed, { outcome });
  } catch (error) {
    if (isCancellation(error)) throw error;
    const terminal = nonRetryableFailureOf(error);
    if (terminal === undefined) {
      setWorkflowPhase(
        `**Phase:** shared match \`${next.riotMatchId}\` failed transiently; preserving its place before retry`,
      );
      await sleep("1 minute");
      return;
    }
    const failed = pending.get(next.riotMatchId) ?? next;
    await recordClientMatchTerminalUntilDurable(stage, failed);
    pending.delete(next.riotMatchId);
    // The deterministic match child remains FAILED in Temporal as the
    // explicit operator-review record. Advancing here prevents immutable
    // conflicting evidence from permanently head-of-line blocking every
    // later match in the environment.
    await acknowledgeClientDispatch(failed, {
      outcome: "terminal-failure",
      ...(terminal.type === null || terminal.type === undefined
        ? {}
        : { failureType: terminal.type }),
    });
  }
}

async function routeLateClientDispatchToReview(
  stage: ScoutStage,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  next: ScoutClientMatchDispatchItemV2,
): Promise<void> {
  setWorkflowPhase(
    `**Phase:** routing late offline match \`${next.riotMatchId}\` to operator review`,
  );
  await recordClientMatchTerminalUntilDurable(stage, next);
  const reviewed = lateArrivals.get(next.riotMatchId) ?? next;
  lateArrivals.delete(next.riotMatchId);
  await acknowledgeClientDispatch(reviewed, {
    outcome: "terminal-failure",
    failureType: "ClientMatchLateArrival",
  });
}

/**
 * Take the earliest queued late arrival off the queue, if there is one.
 *
 * A Riot discovery there was queued before the patch, or is a client-only
 * arrival that Riot has since discovered too. Riot vouches for it, so it is
 * processed in order like any other discovery instead of refused.
 */
async function settleFirstLateArrival(
  stage: ScoutStage,
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
): Promise<boolean> {
  const late = firstClientDispatchItem(lateArrivals);
  if (late === undefined) return false;
  if (
    clientDispatchIsRiotDiscovery(late) &&
    patched(SCOUT_V2_DISPATCH_RIOT_BYPASSES_WATERMARK_PATCH)
  ) {
    lateArrivals.delete(late.riotMatchId);
    mergeClientDispatchItem(pending, late);
    return true;
  }
  await routeLateClientDispatchToReview(stage, lateArrivals, late);
  return true;
}

function mergeSignaledClientDispatchItem(
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  orderingWatermark: ScoutClientMatchDispatchOrderKeyV2 | null,
  match: ScoutClientMatchDispatchItemV2,
): void {
  // Keep merging an active match too: a Riot discovery can arrive while a
  // client-started child is running and still needs its completion ack.
  if (pending.has(match.riotMatchId)) {
    mergeClientDispatchItem(pending, match);
    const merged = pending.get(match.riotMatchId);
    if (
      merged !== undefined &&
      clientDispatchNeedsLateReview(merged, orderingWatermark)
    ) {
      pending.delete(match.riotMatchId);
      mergeClientDispatchItem(lateArrivals, merged);
    }
    return;
  }
  if (lateArrivals.has(match.riotMatchId)) {
    mergeClientDispatchItem(lateArrivals, match);
    return;
  }
  if (clientDispatchNeedsLateReview(match, orderingWatermark)) {
    mergeClientDispatchItem(lateArrivals, match);
    return;
  }
  mergeClientDispatchItem(pending, match);
}

function mergeSignaledClientDispatchBatch(
  rawBatch: unknown,
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  orderingWatermark: ScoutClientMatchDispatchOrderKeyV2 | null,
): void {
  const batch = ScoutClientMatchDispatchBatchV2Schema.parse(rawBatch);
  for (const match of batch) {
    mergeSignaledClientDispatchItem(
      pending,
      lateArrivals,
      orderingWatermark,
      match,
    );
  }
}

function firstProcessableClientDispatch(
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItemV2>,
  orderingWatermark: ScoutClientMatchDispatchOrderKeyV2 | null,
): ScoutClientMatchDispatchItemV2 | undefined {
  const next = firstClientDispatchItem(pending);
  if (next === undefined) return undefined;
  if (!clientDispatchNeedsLateReview(next, orderingWatermark)) return next;
  pending.delete(next.riotMatchId);
  mergeClientDispatchItem(lateArrivals, next);
  return undefined;
}

function advanceClientDispatchWatermark(
  current: ScoutClientMatchDispatchOrderKeyV2 | null,
  next: ScoutClientMatchDispatchItemV2,
): ScoutClientMatchDispatchOrderKeyV2 {
  return current === null ||
    (next.riotMatchId !== current.riotMatchId &&
      compareClientDispatchItemToOrderKey(next, current) > 0)
    ? clientDispatchOrderKey(next)
    : current;
}

/**
 * The durable serialization point for Riot and native-client post-game work.
 *
 * Signals from every discovery source land on one execution per environment.
 * Accepted work is deduplicated and ordered by match completion time, and a
 * child is awaited before the next match may start. Native-client evidence
 * arriving behind the durable ordering frontier is routed to review instead
 * of settling out of order. This protects bounded Dare settlement from a
 * later match overtaking an earlier one. Riot discoveries are exempt: each
 * account's cursor is what orders that player's matches, and one frontier
 * across accounts polled in rotation refuses legitimate backlog.
 */
export async function scoutClientMatchDispatchV2Workflow(
  rawInput: ScoutClientMatchDispatchV2InputEnvelope,
): Promise<never> {
  const input = scoutClientMatchDispatchV2InputCodec.parse(rawInput);
  const pending = new Map<RiotMatchId, ScoutClientMatchDispatchItemV2>();
  for (const match of input.pending) mergeClientDispatchItem(pending, match);
  const lateArrivals = new Map<RiotMatchId, ScoutClientMatchDispatchItemV2>();
  for (const match of input.lateArrivals) {
    mergeClientDispatchItem(lateArrivals, match);
  }
  let orderingWatermark = input.orderingWatermark;

  setHandler(dispatchScoutClientMatchesV2Signal, (rawBatch) => {
    mergeSignaledClientDispatchBatch(
      rawBatch,
      pending,
      lateArrivals,
      orderingWatermark,
    );
  });

  for (;;) {
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof scoutClientMatchDispatchV2Workflow>(
        scoutClientMatchDispatchV2InputCodec.serialize({
          stage: input.stage,
          pending: [...pending.values()].sort(compareClientDispatchItems),
          lateArrivals: [...lateArrivals.values()].sort(
            compareClientDispatchItems,
          ),
          orderingWatermark,
        }),
      );
    }

    if (await settleFirstLateArrival(input.stage, pending, lateArrivals)) {
      continue;
    }

    if (pending.size === 0) {
      setWorkflowPhase("**Phase:** waiting for native match observations");
      await condition(() => pending.size > 0 || lateArrivals.size > 0);
      continue;
    }

    const next = firstProcessableClientDispatch(
      pending,
      lateArrivals,
      orderingWatermark,
    );
    if (next === undefined) continue;
    if (!(await waitForClientDispatchReady(pending, next))) continue;
    orderingWatermark = advanceClientDispatchWatermark(orderingWatermark, next);
    await processReadyClientDispatch(input.stage, pending, next);
  }
}
