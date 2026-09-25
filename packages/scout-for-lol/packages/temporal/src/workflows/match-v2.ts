import { z } from "zod";
import { ApplicationFailure, patched, startChild } from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type {
  IsoInstant,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ScoutDiscoveredMatchV2 } from "#src/activity-contracts-v2.ts";
import type { ScoutDurableCommitV2 } from "#src/contracts-v2.ts";
import type {
  MatchDeliveryMode,
  MatchProcessingPolicy,
  PipelineOwner,
  ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  scoutMatchProcessingV2InputCodec,
  scoutMatchProcessingV2ResultCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPostMatchDiscoveryV2ResultCodec,
  type ScoutMatchProcessingV2InputEnvelope,
  type ScoutMatchProcessingV2ResultEnvelope,
  type ScoutPostMatchDiscoveryV2InputEnvelope,
  type ScoutPostMatchDiscoveryV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import {
  scoutMatchProcessingV2WorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
} from "#src/match-receipts-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import {
  realtimeActivities,
  realtimeV2Activities,
} from "./activity-options.ts";
import { ScoutDiscoveredMatchV2Schema } from "#src/activity-contracts-v2.ts";
import {
  IMPLEMENTED_V2_FAN_OUT_WORKFLOWS,
  planMatchFanOutChildrenV2,
  type ScoutMatchFanOutChildV2,
} from "./match-fan-out-v2.ts";
import {
  ScoutDispatchableDiscoveredMatchesV2Schema,
  installMatchDispatchCompletionHandler,
  processDiscoveredMatchesThroughDispatcher,
} from "./shared-match-dispatch-v2.ts";
import { delegateWhenV1OwnsDiscovery } from "./ownership/postmatch-ownership-v2.ts";

/**
 * One discovered match as the loop consumes it: the id always, and the fields
 * a pre-change history never recorded only when they are there.
 */
const ScoutDiscoveredMatchesSchema = z
  .array(ScoutDiscoveredMatchV2Schema)
  .readonly();

export type ScoutDiscoveredMatchV2Ref = {
  readonly riotMatchId: RiotMatchId;
  readonly sourcePuuid?: ScoutDiscoveredMatchV2["sourcePuuid"] | undefined;
  readonly deliveryMode?: ScoutDiscoveredMatchV2["deliveryMode"] | undefined;
  readonly gameEndTimestamp?:
    ScoutDiscoveredMatchV2["gameEndTimestamp"] | undefined;
};

/**
 * The page this run processes, from whichever result shape its history holds.
 *
 * ## Why this reads the payload rather than a patch flag
 *
 * There is more than one pre-change generation in play, and they differ in
 * DIFFERENT fields: the oldest recorded bare `riotMatchIds`, the generation
 * before this one recorded `pollOwner` as well, and the current one records
 * `matches` too. A single boolean meaning "not the newest" cannot tell those
 * apart, and using one made the legacy branch drop `pollOwner` from a history
 * that had recorded it — silently removing the ownership guard from a close
 * that already had one.
 *
 * Each field's presence in the recorded result is the fact, and it is the
 * fact for that execution forever: a completed Activity's payload never
 * changes, so branching on it decides identically on every replay. That is
 * the determinism a patch would have bought, drawn at the boundary of the
 * change it protects against rather than at the newest shape.
 *
 * The legacy branch yields the id and nothing else, because that is all those
 * results recorded AND all their child-start commands carried. Anything this
 * added would travel into a recorded command's arguments; `live` is supplied
 * where it is still unrecorded, inside the child.
 */
export function discoveredMatchesOf(scan: {
  riotMatchIds: readonly RiotMatchId[];
  matches?: unknown;
}): readonly ScoutDiscoveredMatchV2Ref[] {
  if (scan.matches === undefined) {
    // The id ALONE, which is all that generation recorded.
    //
    // `live` is the right answer for such a match, but supplying it here
    // would be the new code's answer rather than the old code's: the child
    // start is a recorded command, and adding a field to its input makes
    // replay emit different arguments than history holds. A legacy branch has
    // to reproduce what the old code SENT, not what the new code considers a
    // sensible default — a default is exactly the helpful instinct that
    // breaks determinism.
    //
    // The fact is still supplied, one layer down and where nothing has been
    // recorded yet: a child started with no mode resolves `live` in
    // `resolveDeliveryMode`, for the same reason and from the same evidence.
    return scan.riotMatchIds.map((riotMatchId) => ({ riotMatchId }));
  }
  return ScoutDiscoveredMatchesSchema.parse(scan.matches);
}

/**
 * The poll claim a recorded discovery result holds, if it recorded one.
 *
 * `pollOwner` is REQUIRED on the scanned branch of the current contract, so
 * the type alone says it is always there. History disagrees: the oldest
 * generation recorded bare ids and no claim, and those executions replay
 * against this code. The parameter is widened here, at the one place that
 * reads the field, so the absence is expressible rather than asserted away —
 * and so the omission is a value this can be tested on.
 *
 * Absent means absent. There is no claim to guess at, and the close then
 * degrades to the unguarded close that generation always did. Inventing one
 * would make maintenance refuse to close a poll that is genuinely open.
 */
export function pollClaimOf(scan: { pollOwner?: IsoInstant | undefined }): {
  pollOwner?: IsoInstant;
} {
  return scan.pollOwner === undefined ? {} : { pollOwner: scan.pollOwner };
}

/**
 * The delivery mode a recorded observation reports, on either resume path.
 *
 * ## Why this is read off the payload rather than trusted to be there
 *
 * `deliveryMode` was added as a REQUIRED field to two recorded Activity
 * results at once — `commitMatchObservationV2`'s and
 * `readMatchPipelineStateV2`'s. An execution that recorded either before that
 * replays against this code with the field absent, and the value is spread
 * straight into `scoutMatchProcessingV2ResultCodec.serialize`, which requires
 * it. That throws on every replayed Workflow task: a stuck execution rather
 * than a failed one, which no retry clears.
 *
 * As with the discovery page, the fact is the payload's own shape and it is
 * that execution's fact forever, so branching on it decides identically on
 * every replay.
 *
 * `live` is what the generation that recorded those results observed: its
 * observation commit stamped `live` unconditionally. It is the same value the
 * version-1 result migration fills and the same value the row-level migration
 * backfilled, so this reads history rather than choosing.
 *
 * ## What this value does, and does not, decide
 *
 * Nothing. It is REPORTED and never acted on: no consumer of the per-match
 * result reads it, and every gate that decides whether a match may be
 * announced reads the committed observation row itself rather than this. So a
 * legacy history whose standing row says `silent-backfill` — a match v1 owns,
 * or one a recovery batch observed ARCHIVE_ONLY — reports `live` here while
 * still announcing nothing. That mis-report is the residual this leaves; it
 * cannot become a delivery.
 */
export function observedDeliveryModeOf(observation: {
  deliveryMode?: MatchDeliveryMode | undefined;
}): MatchDeliveryMode {
  return observation.deliveryMode ?? "live";
}

async function processLegacyDiscoveredMatches(
  stage: ScoutStage,
  discovered: readonly ScoutDiscoveredMatchV2Ref[],
): Promise<{
  readonly childrenStarted: number;
  readonly ownedWholeTail: boolean;
  readonly childFailure?: unknown;
}> {
  let childrenStarted = 0;
  for (const match of discovered) {
    setWorkflowPhase(`**Phase:** processing match \`${match.riotMatchId}\``);
    try {
      if (!(await processMatchAsChild(stage, match))) {
        return { childrenStarted, ownedWholeTail: false };
      }
    } catch (error) {
      return { childrenStarted, ownedWholeTail: false, childFailure: error };
    }
    childrenStarted += 1;
  }
  return { childrenStarted, ownedWholeTail: true };
}

/**
 * Post-match discovery, V2.
 *
 * Discovers completed matches for tracked accounts, then starts one
 * `scoutMatchProcessingV2Workflow` child per match, serialized in discovery
 * order. Serialization is not incidental: bounded Dare plans are ordered by
 * match end time, so a later match must not settle while an earlier one is
 * still being processed.
 *
 * Child IDs come from `scoutMatchProcessingV2WorkflowId`, so a rediscovered
 * match collapses onto the execution already processing it rather than
 * starting a second one.
 *
 * Maintenance runs last, on every exit from the loop. It is v1's Activity —
 * closing the poll status, settling Dare deadlines, retrying pending earnings,
 * clearing stale markets, recovering notifications — because none of that is
 * per-match work the V2 core could absorb, and a V2-shaped copy would be a
 * second implementation of one maintenance pass.
 *
 * The poll this run opened is held for the WHOLE run, discovery through
 * maintenance, by a durable claim rather than a worker-local flag. That is
 * what makes a second discovery starting mid-run — an operator's, say —
 * observe the poll as held and open none of its own; before it, the flag was
 * released when the discovery Activity returned, the second run opened a poll
 * while this one was still awaiting children, and this run's maintenance then
 * marked the SECOND run's poll complete underneath it.
 */
export async function scoutPostMatchDiscoveryV2Workflow(
  rawInput: ScoutPostMatchDiscoveryV2InputEnvelope,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope> {
  const input = scoutPostMatchDiscoveryV2InputCodec.parse(rawInput);
  // Ownership is decided before anything else this run does, and a run v1
  // owns ends here. See `ownership/postmatch-ownership-v2.ts` for why only one pipeline
  // can discover at a time.
  const delegated = await delegateWhenV1OwnsDiscovery(input);
  if (delegated !== null) return delegated;
  const dispatchResults = installMatchDispatchCompletionHandler();
  setWorkflowPhase("**Phase:** discovering completed matches");
  const scan = await realtimeV2Activities(input.stage).discoverPostMatchIdsV2(
    input,
  );
  if (scan.outcome === "skipped") {
    // A poll claimed by another run still holds the status, and discovery
    // refused to open a second one. This run opened nothing, so it closes
    // nothing: running maintenance here would mark the OTHER execution's poll
    // complete under it, flipping the shared status while that poll is live.
    setWorkflowPhase("**Phase:** discovery skipped; a poll is already running");
    return scoutPostMatchDiscoveryV2ResultCodec.serialize({
      status: "no-op",
      discovered: 0,
      childrenStarted: 0,
      complete: false,
    });
  }

  // `matches`, `pollOwner` and each match's `sourcePuuid` and `deliveryMode`
  // were all added to this Activity's result as REQUIRED fields. A field being
  // new is not the same as it being safe: an execution that recorded an
  // earlier result replays against this code with `riotMatchIds` and nothing
  // else, so iterating `scan.matches` would read `undefined` and fail the
  // Workflow task on every replay, forever — a stuck execution rather than a
  // failed one, which no retry clears.
  //
  // Each field is therefore read where it is consumed, off the recorded
  // payload; see {@link discoveredMatchesOf} for why the payload itself is
  // the deterministic fact and a patch flag was the wrong boundary.
  const discovered = discoveredMatchesOf(scan);

  let childrenStarted: number;
  let ownedWholeTail: boolean;
  let childFailure: unknown;
  const dispatchable =
    ScoutDispatchableDiscoveredMatchesV2Schema.safeParse(discovered);
  if (dispatchable.success) {
    setWorkflowPhase("**Phase:** awaiting the shared match serializer");
    const dispatched = await processDiscoveredMatchesThroughDispatcher(
      input.stage,
      dispatchable.data,
      dispatchResults,
    );
    childrenStarted = dispatched.childrenStarted;
    ownedWholeTail = dispatched.ownedWholeTail;
    childFailure = dispatched.childFailure;
  } else {
    // Replay-only branch: these Activity results were recorded before game end
    // timestamps crossed the boundary, so they must emit the direct child
    // commands their histories already hold.
    const legacy = await processLegacyDiscoveredMatches(
      input.stage,
      discovered,
    );
    childrenStarted = legacy.childrenStarted;
    ownedWholeTail = legacy.ownedWholeTail;
    childFailure = legacy.childFailure;
  }

  // Maintenance closes the poll this run opened, and it runs on EVERY exit
  // from the loop — success, an owned child ID, or a failed child — because
  // `BotState.pollStatus` is what the next poll reads to decide whether one is
  // already in flight. A run that failed without closing it would look like a
  // poll still running. v1 orders it exactly here and for exactly this reason,
  // and the flags below are v1's.
  //
  // `pollOwner` is what makes that close THIS run's. Discovery claims the poll
  // durably and the claim stands across the children awaited above, so the
  // close names the poll it opened: a second discovery that started meanwhile
  // was told the poll was held and opened none, and a run whose claim was
  // taken over closes nothing and fails here rather than marking a newer
  // run's poll complete underneath it.
  setWorkflowPhase("**Phase:** running post-match maintenance");
  await realtimeActivities(input.stage).runPostMatchMaintenance({
    stage: input.stage,
    // Dare deadlines may only settle when the whole tail was seen AND
    // processed: an unseen page, a match another execution still owns, or a
    // failed child all mean evidence this pass cannot vouch for.
    settleDareV2Deadlines:
      scan.complete && ownedWholeTail && childFailure === undefined,
    // Forwarded whenever the history recorded one, which the generation
    // before this one already did. Tying it to the `matches` branch dropped it
    // from those histories and took the ownership guard off their close; only
    // the OLDEST generation recorded no claim at all, and for those there is
    // nothing to forward.
    ...pollClaimOf(scan),
    ...(scan.evidenceWatermark === undefined
      ? {}
      : { evidenceWatermark: scan.evidenceWatermark }),
  });

  if (childFailure !== undefined) {
    if (childFailure instanceof Error) throw childFailure;
    throw ApplicationFailure.nonRetryable(
      `A V2 match child failed with a non-Error value during ${input.stage} post-match discovery`,
      "MatchProcessingChildFailure",
    );
  }

  return scoutPostMatchDiscoveryV2ResultCodec.serialize({
    status: "completed",
    discovered: scan.riotMatchIds.length,
    childrenStarted,
    complete: scan.complete && ownedWholeTail,
  });
}

/**
 * Start one match child and wait for it, or report that its ID was taken.
 *
 * A child FAILURE propagates: the run that discovered an unprocessable match
 * must fail visibly rather than report a completed discovery that quietly did
 * less than it found. Only the already-started rejection is an answer rather
 * than a fault — some other execution is driving that match.
 */
export async function processMatchAsChild(
  stage: ScoutStage,
  match: ScoutDiscoveredMatchV2Ref,
): Promise<boolean> {
  try {
    const child = await startChild(scoutMatchProcessingV2Workflow, {
      workflowId: scoutMatchProcessingV2WorkflowId(stage, match.riotMatchId),
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
      taskQueue: scoutTaskQueues(stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [
        scoutMatchProcessingV2InputCodec.serialize({
          stage,
          riotMatchId: match.riotMatchId,
          // Both omitted on a pre-change history. The input makes them
          // optional and the child handles their absence explicitly: the
          // source precondition is skipped, and the delivery mode is taken
          // from the observation already standing for the match.
          ...(match.sourcePuuid === undefined
            ? {}
            : { sourcePuuid: match.sourcePuuid }),
          ...(match.deliveryMode === undefined
            ? {}
            : { deliveryMode: match.deliveryMode }),
        }),
      ],
    });
    await child.result();
    return true;
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
    throw error;
  }
}

/**
 * Refuse to build on a durable commit that is contested.
 *
 * `conflict` means a row already stands for that identity carrying DIFFERENT
 * evidence. Discarding it would let this run attest to the phase, derive the
 * next step's inputs from a claim it never agreed with, and advance the cursor
 * over detected drift — after which nothing looks at the match again. So any
 * conflict fails the run, the same way a contested settlement fact or a
 * contested observation does.
 *
 * One asserter rather than one per result shape: an archived artifact and a
 * stage receipt carry the same `ScoutDurableCommitV2`, and the decision taken
 * over it is identical.
 *
 * A conflict here is never the system racing itself. The raw-archive evidence
 * names the artifact by identity alone — kind, key, digest, bytes, content
 * type — with the capture instant kept as the receipt's own `recordedAt`, so
 * two attestations of the same bytes agree however far apart they were
 * stamped (evidence version 2 in `report-lake/durable-receipts.ts`; the
 * version-1 rows beta holds are read as version 1 wrote them). And the door
 * answers a rival writer from the standing receipt under its fence, so a
 * conflict that survives both is genuinely different bytes attested under one
 * identity. It self-heals only in the sense that the next attempt read-gates
 * on whichever receipt stands; the disagreement itself is a person's to look
 * at.
 */
function assertCommitsUncontested(
  riotMatchId: RiotMatchId,
  subject: string,
  commits: readonly { label: string; commit: ScoutDurableCommitV2 }[],
): void {
  const contested = commits.flatMap((entry) =>
    entry.commit.outcome === "conflict"
      ? [`${entry.label} (${entry.commit.reason})`]
      : [],
  );
  if (contested.length === 0) return;
  throw ApplicationFailure.nonRetryable(
    `The ${subject} for ${riotMatchId} disagree with what already stands for them: ${contested.join(", ")}. Refusing to attest to the phase or advance the cursor over drift nothing has reconciled`,
    "DurableCommitConflict",
  );
}

/**
 * Start the planned children that have a body behind them, and count what took.
 *
 * The plan is computed first and started second so the fan-out DECISION stays a
 * pure function of the durable state: `match-fan-out-v2.ts` holds no
 * `startChild` and is assertable without a Temporal environment. This filters
 * the plan on the same allowlist that module's `startableMatchFanOutCountsV2`
 * predicate reads, so what is startable and what is counted as startable cannot
 * drift apart.
 *
 * `parentClosePolicy: "ABANDON"` throughout, because a notification outlives
 * the match run that promised it and the parent closing must not cancel a send
 * in flight.
 *
 * The reuse policies differ by family and the difference is load-bearing. A
 * notification uses ALLOW_DUPLICATE because its durable ROW, not this
 * Workflow's completion, decides whether work remains: a run that completed by
 * recording `unknown-delivery` SUCCEEDED at its job, the operator resolution
 * that releases the intent happens out of band, and the fresh run that follows
 * must not be refused for following a successful execution. A lake projection
 * uses ALLOW_DUPLICATE_FAILED_ONLY: once it has staged there is nothing left to
 * do, and a re-projection after a lake rebuild would be a differently-derived
 * ID for reconciliation to start, not a loosened policy here.
 *
 * An ID already in use is an answer rather than a fault — some execution is
 * already driving that work — so it is not counted as started.
 */
async function startMatchFanOutChildrenV2(
  stage: ScoutStage,
  children: readonly ScoutMatchFanOutChildV2[],
): Promise<{ notifications: number; lakeProjections: number }> {
  const started = { notifications: 0, lakeProjections: 0 };
  for (const child of children) {
    if (!IMPLEMENTED_V2_FAN_OUT_WORKFLOWS.includes(child.workflowType))
      continue;
    try {
      await startChild(child.workflowType, {
        workflowId: child.workflowId,
        workflowIdReusePolicy:
          child.family === "notifications"
            ? "ALLOW_DUPLICATE"
            : "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [child.input],
      });
      started[child.family] += 1;
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  return started;
}

/**
 * Attest to the phases this run completed, if it completed any.
 *
 * One call, after the last domain effect, rather than a receipt beside each
 * one. A run killed between an effect and this call re-runs that effect on its
 * next attempt — which every phase is built to survive — while a run killed
 * after it skips them. Splitting the attestation per phase would not remove
 * that window, only move it.
 */
async function attestPhases(
  activities: ReturnType<typeof realtimeV2Activities>,
  ref: { stage: ScoutStage; riotMatchId: RiotMatchId },
  kinds: readonly ReceiptKind[],
): Promise<void> {
  if (kinds.length === 0) return;
  setWorkflowPhase("**Phase:** recording this run's match receipts");
  const recorded = await activities.recordMatchReceiptsV2({ ...ref, kinds });
  // A contested stage receipt is a broken contract: the evidence a V2 stage
  // receipt carries is derived from the match reference and the phase alone,
  // so two runs can only disagree about it if something is producing evidence
  // no rule here can produce. Advancing the cursor over that would let the
  // NEXT execution skip the phase on the strength of a receipt this run never
  // agreed with — and the Activity has already recorded the durable marker
  // that makes the next execution refuse at its resume point, so failing here
  // stays failed until a person looks.
  assertCommitsUncontested(
    ref.riotMatchId,
    "stage receipts",
    recorded.receipts.map((receipt) => ({
      label: receipt.kind,
      commit: receipt.commit,
    })),
  );
}

/**
 * Commit the observation this run needs, carrying whatever its starter knew.
 *
 * `sourcePuuid` and `deliveryMode` are spread only when present because the
 * envelope is strict and their ABSENCE is meaningful: a reconciliation restart
 * has neither, and the Activity answers each from the standing observation
 * rather than inventing one. Extracted from the core so the two conditional
 * spreads do not spend the core's complexity budget.
 */
async function commitObservation(
  activities: ReturnType<typeof realtimeV2Activities>,
  ref: { stage: ScoutStage; riotMatchId: RiotMatchId },
  input: {
    sourcePuuid?: LeaguePuuid | undefined;
    deliveryMode?: MatchDeliveryMode | undefined;
  },
): Promise<{
  owner: PipelineOwner;
  policy: MatchProcessingPolicy;
  deliveryMode: MatchDeliveryMode;
}> {
  setWorkflowPhase("**Phase:** committing the match observation");
  return await activities.commitMatchObservationV2({
    ...ref,
    ...(input.sourcePuuid === undefined
      ? {}
      : { sourcePuuid: input.sourcePuuid }),
    ...(input.deliveryMode === undefined
      ? {}
      : { deliveryMode: input.deliveryMode }),
  });
}

/**
 * The marker that says a history was recorded by a run that minted its
 * postmatch intents from the Workflow.
 *
 * Named once so the gate and its pin cannot drift apart, and never reused: a
 * patch id identifies ONE change to one Workflow's command sequence for the
 * life of that Workflow, so changing this string would silently re-run the
 * decision for every execution that already made it.
 */
export const SCOUT_V2_MATCH_MINT_INTENTS_PATCH = "scout-v2-match-mint-intents";

/**
 * The per-match core, V2.
 *
 * Phases, in order: archive the raw artifacts, commit the observation, settle
 * markets, apply progression, finalize any managed-custom result, record receipts,
 * advance tracked-account cursors, and only then fan out notification and
 * lake-projection children.
 *
 * Fan-out happens after the domain commit because a notification is a promise
 * about a fact: a child started before the commit could deliver a claim the
 * pipeline then fails to make durable. `readMatchPipelineStateV2` is the
 * resume point — one aggregate read spanning observation, receipts, intents
 * and tracked accounts — so a restarted execution skips the phases that
 * already happened instead of re-applying them.
 *
 * Every phase gate reads a V2 stage receipt (`match-receipts-v2.ts`), and the
 * receipts are written in ONE Activity after the last domain effect and before
 * the cursor moves. That ordering is the crash contract: a run killed between
 * an effect and its receipt re-runs the effect, which is safe because each is
 * guarded by an at-most-once claim or is idempotent by construction, while a
 * run killed after the receipts skips them. The cursor advance is last because
 * it is what stops the match being rediscovered at all.
 *
 * ## Where this deliberately differs from v1
 *
 * v1 advances the account cursor INSIDE `withChallengeProgressionLock`, as the
 * tail of its progression section. V2 does not, and the ruling was made on
 * evidence rather than by omission. Three facts decided it. The phase order
 * here runs tournament finalization and the stage receipts between
 * progression and the cursor, and v1 itself finalizes tournaments before its
 * lock so "a failure leaves the cursors in place"; advancing inside
 * progression's fence would move the cursor past an unfinalized tournament
 * match. A run that dies inside the fence after progression's receipt is
 * reconciled on the next attempt by the fence's takeover probe, which
 * completes the claim from the standing receipt WITHOUT re-running the
 * effect — so an in-fence cursor advance would never run on that path and the
 * separate Activity would be needed anyway. And the hazard v1's placement
 * guards — an unconditional cursor write reordered by a rival — is closed
 * here by `advanceAccountCursor`'s monotonic guard and by discovery running
 * its children serially, while nothing under the progression lock reads the
 * cursor. The cursor therefore stays the last Activity, after the receipts.
 *
 * v1 also refuses a match whose discovering account is no longer tracked
 * (`ingestDiscoveredMatch`). V2's platform check is NOT equivalent — a
 * deregistered source makes v1 refuse the match while V2 would process it for
 * the remaining tracked participants, or with none — so the precondition is
 * RESTORED rather than proven equivalent: discovery carries `sourcePuuid`
 * into the input, and `commitMatchObservationV2` fails non-retryably before
 * any effect unless that account is still tracked and played in the match.
 * A run with no source — a reconciliation restart — resumes an observation
 * that already passed the check when it was committed.
 */
export async function scoutMatchProcessingV2Workflow(
  rawInput: ScoutMatchProcessingV2InputEnvelope,
): Promise<ScoutMatchProcessingV2ResultEnvelope> {
  const input = scoutMatchProcessingV2InputCodec.parse(rawInput);
  const activities = realtimeV2Activities(input.stage);
  const ref = { stage: input.stage, riotMatchId: input.riotMatchId };

  setWorkflowPhase("**Phase:** reading the match resume point");
  const resume = await activities.readMatchPipelineStateV2(ref);
  if (resume.kind === "terminal") {
    throw ApplicationFailure.nonRetryable(
      `Match ${input.riotMatchId} is awaiting review (${SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND} stands); refusing to restart its failed pipeline`,
      "ClientMatchTerminalReview",
    );
  }
  const observed = resume.kind === "present" ? resume.state : null;
  const attested = new Set<ReceiptKind>(observed?.receiptKinds);
  if (attested.has(SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND)) {
    // A previous execution met a contested stage receipt and recorded that
    // it did. Without this gate the standing kinds below would read as phases
    // already done, and this execution would skip them and advance the cursor
    // over the very disagreement that failed the last one. The marker is an
    // operator's to remove, after looking; nothing here may proceed past it.
    throw ApplicationFailure.nonRetryable(
      `A stage receipt for ${input.riotMatchId} is contested (${SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND} stands); refusing to resume past drift nothing has reconciled. An operator resolves the disagreement and removes the marker before this match is processed again`,
      "DurableCommitConflict",
    );
  }
  const receiptKinds: ReceiptKind[] = [];

  if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.archive)) {
    setWorkflowPhase("**Phase:** archiving the raw match artifacts");
    const archived = await activities.archiveMatchArtifactsV2(ref);
    assertCommitsUncontested(
      input.riotMatchId,
      "archived artifacts",
      archived.artifacts.map((artifact) => ({
        label: `${artifact.receipt.kind} (${artifact.descriptor.key})`,
        commit: artifact.receipt.commit,
      })),
    );
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.archive);
  }

  const resumable =
    observed !== null && attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.observation)
      ? observed
      : null;
  const observation =
    resumable ?? (await commitObservation(activities, ref, input));
  if (resumable === null) {
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.observation);
  }
  const owner: PipelineOwner = observation.owner;
  const policy: MatchProcessingPolicy = observation.policy;
  // Whether this match is owed a public delivery. It is read from the durable
  // observation on both paths — the resume point when one already stands, the
  // commit's own read-back otherwise — and never from this run's input, so a
  // restart that carries no mode cannot turn a silent backfill into an
  // announcement, and a run that carried a disagreeing one has already failed
  // in the commit rather than reaching here.
  const deliveryMode: MatchDeliveryMode = observedDeliveryModeOf(observation);

  if (owner.kind !== "temporal-v2") {
    // Another pipeline holds this match. Capture and observation are
    // owner-independent — the raw payload is canonical whoever archived it —
    // but settlement, progression and the cursor are that owner's to apply,
    // and V2's effect claims are its own, so running them here would double
    // what the owner already did. Ownership exists to make this decidable, so
    // the honest answer is to record what this run attested to and stop.
    await attestPhases(activities, ref, receiptKinds);
    return scoutMatchProcessingV2ResultCodec.serialize({
      status: "no-op",
      riotMatchId: input.riotMatchId,
      owner,
      policy,
      deliveryMode,
      receiptKinds,
      childrenStarted: { notifications: 0, lakeProjections: 0 },
    });
  }

  // ARCHIVE_ONLY means exactly this: the raw payloads are captured and no
  // downstream effect runs. Settlement and progression are those effects.
  if (policy === "FULL") {
    if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.settlement)) {
      setWorkflowPhase("**Phase:** settling this match's markets");
      await activities.settleMatchMarketsV2(ref);
      receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.settlement);
    }
    if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.progression)) {
      setWorkflowPhase("**Phase:** applying competitive progression");
      await activities.applyMatchProgressionV2(ref);
      receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.progression);
    }
  }

  // Tournament-code custom games project their result into a Custom Night
  // before the cursor can advance. v1 finalizes them at exactly this point and
  // is the only caller repo-wide, so a V2 core that skipped it would leave the
  // result unfinalized and the snapshot unpublished — with the cursor moved
  // past the match, so nothing would ever rediscover it. The stage answers
  // The legacy `not-a-tournament-match` result cheaply covers an ordinary match.
  if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.tournament)) {
    setWorkflowPhase("**Phase:** finalizing any managed custom result");
    await activities.finalizeTournamentResultV2(ref);
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.tournament);
  }

  await attestPhases(activities, ref, receiptKinds);

  // Minted BEFORE the cursor moves, and the order is the whole point.
  //
  // Every domain fact this match asserts is already durable here: the
  // observation, the guarded effects and the stage receipts all committed
  // above, so an intent minted now cannot promise a report for something the
  // run then failed to commit. The cursor is not one of those facts. It is
  // what stops the match being rediscovered at all, so it must be the LAST
  // thing that moves.
  //
  // Minting after it was a permanent-loss path. A mint that exhausted its
  // retries or failed non-retryably left every tracked-account cursor already
  // past the match, its observation receipt standing and no association
  // unadvanced — so the reconciliation scan reads the match as finished, and
  // with no intent row there is nothing for the notification scan to recover.
  // Nobody would ever be told the game happened, and nothing would say so.
  // Minting first means a failure leaves the cursor where it was and the next
  // discovery surfaces the match again.
  //
  // Gated, because this is an inserted COMMAND rather than a changed payload.
  //
  // A history recorded before this Activity existed has `advanceMatchCursorV2`
  // where replay would now schedule the mint. That is nondeterminism, and it
  // wedges the execution rather than failing it — no retry clears it, and the
  // match is stuck with its cursor unmoved forever.
  //
  // Everywhere else in this file the pre-change generation is told apart by
  // the recorded payload, which is the better instrument because the payload
  // IS that execution's fact. A command sequence leaves no payload to read:
  // nothing in the history says which generation wrote it except a marker put
  // there for the purpose. So this one is a patch, and the difference is not
  // stylistic — it is which fact exists to be read.
  //
  // The old branch mints nothing, and that is exactly what that generation
  // did: no per-match Activity minted postmatch intents before this one, so
  // an execution replaying past this point already behaves as its own code
  // wrote it. Nothing is lost that that execution ever had.
  //
  // Retire with `deprecatePatch` once no execution predating it can still
  // replay, not before.
  if (patched(SCOUT_V2_MATCH_MINT_INTENTS_PATCH)) {
    setWorkflowPhase("**Phase:** minting the post-match report intents");
    await activities.mintPostmatchNotificationIntentsV2(ref);
  }

  // Last, because it is what stops rediscovery.
  setWorkflowPhase("**Phase:** advancing tracked-account cursors");
  await activities.advanceMatchCursorV2(ref);

  setWorkflowPhase("**Phase:** planning the post-commit fan-out");
  const plan = await activities.planMatchFanOutV2(ref);
  const children = planMatchFanOutChildrenV2({ ...ref, plan });
  const childrenStarted = await startMatchFanOutChildrenV2(
    input.stage,
    children,
  );
  setWorkflowPhase(
    `**Phase:** planned ${String(children.length)} fan-out children, started ${String(childrenStarted.notifications + childrenStarted.lakeProjections)}`,
  );

  return scoutMatchProcessingV2ResultCodec.serialize({
    status: "completed",
    riotMatchId: input.riotMatchId,
    owner,
    policy,
    deliveryMode,
    receiptKinds,
    childrenStarted,
  });
}
