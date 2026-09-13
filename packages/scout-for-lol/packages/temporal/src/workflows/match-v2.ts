import { ApplicationFailure, startChild } from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutArchiveV2Result } from "#src/activity-contracts-v2.ts";
import type {
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
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "#src/match-receipts-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { realtimeV2Activities } from "./activity-options.ts";
import {
  IMPLEMENTED_V2_FAN_OUT_WORKFLOWS,
  planMatchFanOutChildrenV2,
  type ScoutMatchFanOutChildV2,
} from "./match-fan-out-v2.ts";

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
 */
export async function scoutPostMatchDiscoveryV2Workflow(
  rawInput: ScoutPostMatchDiscoveryV2InputEnvelope,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope> {
  const input = scoutPostMatchDiscoveryV2InputCodec.parse(rawInput);
  setWorkflowPhase("**Phase:** discovering completed matches");
  const scan = await realtimeV2Activities(input.stage).discoverPostMatchIdsV2(
    input,
  );

  let childrenStarted = 0;
  let ownedWholeTail = true;
  for (const riotMatchId of scan.riotMatchIds) {
    setWorkflowPhase(`**Phase:** processing match \`${riotMatchId}\``);
    if (!(await processMatchAsChild(input.stage, riotMatchId))) {
      // Another execution already owns this match's ID. Continuing past it
      // would let a LATER match settle while an EARLIER one is still being
      // processed elsewhere, which is exactly the chronology the serialization
      // above exists to preserve — so this run stops and reports that it did
      // not see the whole tail through. The next discovery rediscovers it.
      ownedWholeTail = false;
      break;
    }
    childrenStarted += 1;
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
async function processMatchAsChild(
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): Promise<boolean> {
  try {
    const child = await startChild(scoutMatchProcessingV2Workflow, {
      workflowId: scoutMatchProcessingV2WorkflowId(stage, riotMatchId),
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
      taskQueue: scoutTaskQueues(stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [
        scoutMatchProcessingV2InputCodec.serialize({ stage, riotMatchId }),
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
 * Refuse to build on an artifact whose attestation is contested.
 *
 * Each archived artifact reports its own receipt outcome, and a `conflict`
 * means a receipt for that identity already stands carrying DIFFERENT
 * evidence. Discarding it would let this run attest to the archive phase,
 * derive the observation's artifact identity from a receipt it never agreed
 * with, and advance the cursor over detected drift — the match would never be
 * looked at again. So any conflict fails the run, the same way a contested
 * settlement fact or a contested observation does.
 *
 * Two overlapping archives of the SAME bytes can reach here today, because the
 * raw-archive evidence includes `capturedAt`, which is stamped at put time.
 * That benign race now fails loudly rather than silently, and it self-heals:
 * the next attempt read-gates on the standing receipt and reports the match as
 * already archived without writing anything. Taking `capturedAt` out of the
 * evidence is the real fix and belongs to the receipted door, under a coordinated
 * evidence version bump — beta already holds rows written the old way.
 */
function assertArtifactsUncontested(
  archived: ScoutArchiveV2Result,
  riotMatchId: RiotMatchId,
): void {
  const contested = archived.artifacts.filter(
    (artifact) => artifact.receipt.commit.outcome === "conflict",
  );
  if (contested.length === 0) return;
  const detail = contested
    .map((artifact) => `${artifact.receipt.kind} (${artifact.descriptor.key})`)
    .join(", ");
  throw ApplicationFailure.nonRetryable(
    `Archived artifacts for ${riotMatchId} disagree with the receipts already standing for them: ${detail}. Refusing to attest to the archive or advance the cursor over drift nothing has reconciled`,
    "ArchiveReceiptConflict",
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
  await activities.recordMatchReceiptsV2({ ...ref, kinds });
}

/**
 * The per-match core, V2.
 *
 * Phases, in order: archive the raw artifacts, commit the observation, settle
 * markets, apply progression, finalize any tournament result, record receipts,
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
 */
export async function scoutMatchProcessingV2Workflow(
  rawInput: ScoutMatchProcessingV2InputEnvelope,
): Promise<ScoutMatchProcessingV2ResultEnvelope> {
  const input = scoutMatchProcessingV2InputCodec.parse(rawInput);
  const activities = realtimeV2Activities(input.stage);
  const ref = { stage: input.stage, riotMatchId: input.riotMatchId };

  setWorkflowPhase("**Phase:** reading the match resume point");
  const resume = await activities.readMatchPipelineStateV2(ref);
  const observed = resume.kind === "present" ? resume.state : null;
  const attested = new Set<ReceiptKind>(observed?.receiptKinds);
  const receiptKinds: ReceiptKind[] = [];

  if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.archive)) {
    setWorkflowPhase("**Phase:** archiving the raw match artifacts");
    assertArtifactsUncontested(
      await activities.archiveMatchArtifactsV2(ref),
      input.riotMatchId,
    );
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.archive);
  }

  let owner: PipelineOwner;
  let policy: MatchProcessingPolicy;
  if (
    observed !== null &&
    attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.observation)
  ) {
    owner = observed.owner;
    policy = observed.policy;
  } else {
    setWorkflowPhase("**Phase:** committing the match observation");
    const observation = await activities.commitMatchObservationV2(ref);
    owner = observation.owner;
    policy = observation.policy;
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.observation);
  }

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
  // `not-a-tournament-match` cheaply for an ordinary match.
  if (!attested.has(SCOUT_V2_MATCH_RECEIPT_KINDS.tournament)) {
    setWorkflowPhase("**Phase:** finalizing any tournament result");
    await activities.finalizeTournamentResultV2(ref);
    receiptKinds.push(SCOUT_V2_MATCH_RECEIPT_KINDS.tournament);
  }

  await attestPhases(activities, ref, receiptKinds);

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
    receiptKinds,
    childrenStarted,
  });
}
