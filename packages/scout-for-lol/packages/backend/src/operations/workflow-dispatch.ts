import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type {
  NotificationIntentKey,
  RiotMatchId,
  WorkflowStartRequestId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutWorkflowStartRequest } from "@scout-for-lol/domain/recovery/workflow-start.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  ScoutLakeProjectionV2InputSchema,
  ScoutNotificationV2InputSchema,
  ScoutPipelineReconciliationV2InputSchema,
} from "@scout-for-lol/temporal/workflow-contracts-v2";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  recordWorkflowStartAccepted,
  requestWorkflowStart,
} from "#src/database/durable/workflow-start-repository.ts";
import { scoutTemporalStartsAvailable } from "#src/temporal/availability.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import {
  startScoutLakeProjectionV2,
  startScoutNotificationV2,
  startScoutPipelineReconciliationV2,
} from "#src/temporal/starts-v2.ts";

/**
 * Dispatching an operator's Workflow start, after the confirmation intent has
 * been claimed and committed.
 *
 * The order is the contract: the durable request row is written BEFORE the
 * start call, so a crash between the two leaves evidence that a start was
 * intended, and acceptance is recorded after.
 *
 * This deliberately does NOT go through `withRecordedWorkflowStart`, and the
 * reason is the strict-V2 inversion rather than a preference. That helper wraps
 * its writes in `recordDurableWrite`, which is fail-open: it swallows
 * repository errors and reports nothing to its caller. That is the right
 * posture for the v1 dual-write path, where a durable record is a best-effort
 * observation alongside the real work. It is the wrong posture here, where the
 * durable record IS the work and a human is being told what happened — an
 * operator surface that reported success over a suppressed `request-differs`
 * would be claiming an effect that did not occur. So the repository is called
 * directly and every conflict is thrown.
 *
 * V2 Workflow ids are derived from identity alone — the match, the intent key,
 * the reconciliation trigger — so the same id is requested many times over a
 * Workflow's life, and `ScoutWorkflowStart` holds one row per REQUEST. A
 * request while a previous one is still in flight (recorded, not yet
 * accepted) adopts it; a request after the previous one was accepted is a new
 * row. What Temporal then does with the id is its policies' business: the
 * conflict policy joins a running execution, the reuse policy decides whether
 * a closed one re-runs. Both are reported as what they are, below.
 *
 * What is NOT reported is which of those two happened when the client cannot
 * tell them apart. `USE_EXISTING` makes "began it" and "joined it" the same
 * answer on the wire, and this SDK does not carry the server's `started`
 * flag, so the outcomes below state the accepted handoff and the running run
 * and claim authorship only where the durable record proves the negative.
 */

export type OperationsWorkflowStart =
  | { readonly kind: "reconcile-pipeline" }
  | { readonly kind: "repair-projection"; readonly riotMatchId: RiotMatchId }
  | {
      readonly kind: "retry-notification";
      readonly intentKey: NotificationIntentKey;
    };

export type OperationsDispatchResult =
  /**
   * The request was recorded and accepted, and the run named here is running.
   *
   * It is deliberately NOT a claim that this call began that run, because the
   * client cannot know. `USE_EXISTING` joins an execution that is already
   * open, and the SDK's answer is identical either way: the SERVER does say
   * which happened — `StartWorkflowExecutionResponse.started`, "if true, a new
   * workflow was started" — but `@temporalio/client` 1.22.0 reads that field
   * in `_startWorkflowHandler` and returns only `{ runId, eagerlyStarted }`,
   * so it reaches no supported surface. (`eagerlyStarted` is about eager task
   * dispatch to a local worker, not about who created the execution.)
   *
   * Inferring creation from a run id the durable record has not seen is not a
   * substitute, and that inference was this module's bug. These Workflow ids
   * are also started from inside the Workflow sandbox — the reconciliation
   * sweep's child starts and the match fan-out — where nothing can write a
   * durable request row. So an unrecognised run is equally consistent with
   * this call having begun it and with a sandbox starter having begun it a
   * moment earlier and this start having joined it.
   *
   * What is true is what this says: the handoff was accepted, and this run is
   * running. Authorship is left unclaimed.
   */
  | {
      readonly outcome: "reached-running";
      readonly requestId: WorkflowStartRequestId;
      readonly requestedWorkflowId: string;
      readonly runId: string;
    }
  /**
   * No new execution began, and this one is PROVEN rather than inferred: the
   * run Temporal answered with is the one a PREVIOUS accepted request for this
   * Workflow id already recorded. That acceptance was written before this call
   * asked Temporal anything, so the execution existed before this call and the
   * conflict policy joined it. This call cannot have begun it.
   *
   * The negative is the only side of authorship a client can establish here,
   * which is why it is the only one this union states.
   */
  | {
      readonly outcome: "joined-running";
      readonly requestId: WorkflowStartRequestId;
      readonly requestedWorkflowId: string;
      readonly runId: string;
    }
  /**
   * The request is durably recorded but Temporal could not be reached. The
   * reconciliation sweep re-drives unaccepted starts of the foldable families
   * (notification, lake projection); an unaccepted reconciliation start is
   * recovered by requesting it again, which adopts this row.
   */
  | {
      readonly outcome: "unavailable";
      readonly requestId: WorkflowStartRequestId;
      readonly requestedWorkflowId: string;
    }
  /**
   * Temporal refused to reuse the Workflow id: a previous execution closed and
   * this family's reuse policy does not permit re-running it. For a projection
   * that means the prior run SUCCEEDED and there is nothing left to stage —
   * `ALLOW_DUPLICATE_FAILED_ONLY` re-runs only after a failure.
   *
   * The request row stays, unaccepted. That is correct rather than litter: the
   * sweep folds unaccepted starts of this family, attempts the same start, and
   * treats the same refusal as an answer instead of a fault; and the next
   * operator request for this id adopts the row rather than adding another.
   */
  | {
      readonly outcome: "already-run";
      readonly requestId: WorkflowStartRequestId;
      readonly requestedWorkflowId: string;
    };

type PlannedStart = {
  readonly requestedWorkflowId: string;
  readonly workflowType: string;
  readonly requestSource: string;
  readonly input: unknown;
  readonly start: () => Promise<{ firstExecutionRunId: string }>;
};

function planStart(
  stage: ScoutStage,
  request: OperationsWorkflowStart,
): PlannedStart {
  const supervisor = currentScoutTemporalSupervisor();
  switch (request.kind) {
    case "reconcile-pipeline": {
      const input = ScoutPipelineReconciliationV2InputSchema.parse({
        stage,
        trigger: "operator",
      });
      return {
        requestedWorkflowId: scoutPipelineReconciliationV2WorkflowId(
          stage,
          input.trigger,
        ),
        workflowType: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
        requestSource: "operations:reconcile-pipeline",
        input,
        start: async () =>
          await startScoutPipelineReconciliationV2(
            requireClient(supervisor),
            input,
          ),
      };
    }
    case "repair-projection": {
      const input = ScoutLakeProjectionV2InputSchema.parse({
        stage,
        riotMatchId: request.riotMatchId,
      });
      return {
        requestedWorkflowId: scoutLakeProjectionV2WorkflowId(
          stage,
          input.riotMatchId,
        ),
        workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
        requestSource: "operations:repair-projection",
        input,
        start: async () =>
          await startScoutLakeProjectionV2(requireClient(supervisor), input),
      };
    }
    case "retry-notification": {
      const input = ScoutNotificationV2InputSchema.parse({
        stage,
        intentKey: request.intentKey,
      });
      return {
        requestedWorkflowId: scoutNotificationV2WorkflowId(
          stage,
          input.intentKey,
        ),
        workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
        requestSource: "operations:retry-notification",
        input,
        start: async () =>
          await startScoutNotificationV2(requireClient(supervisor), input),
      };
    }
  }
}

function requireClient(
  supervisor: ReturnType<typeof currentScoutTemporalSupervisor>,
) {
  if (supervisor === undefined) {
    throw new Error(
      "Temporal supervisor is unavailable; availability is checked before the start",
    );
  }
  return supervisor.client();
}

/**
 * Ask Temporal to start, treating a reuse-policy refusal as an answer.
 *
 * `WorkflowExecutionAlreadyStartedError` here does not mean something went
 * wrong; it means the family's reuse policy declined to re-run a closed
 * execution, which is the policy working. Every OTHER failure — a transport
 * error, a bad task queue, a rejected argument — stays thrown, because those
 * are faults and an operator surface must not report them as outcomes. The
 * reconciliation sweep draws the same line for its own child starts.
 */
async function startOrRefusal(
  planned: PlannedStart,
): Promise<{ firstExecutionRunId: string } | "already-run"> {
  try {
    return await planned.start();
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return "already-run";
    }
    throw error;
  }
}

/**
 * Record the operator's start request, then ask Temporal to run it.
 *
 * @throws when a durable write conflicts: a different start already claims
 * this Workflow id. That is a broken derivation rather than an expected
 * operator outcome. A request that was already answered is NOT one of these —
 * an adopted request has two drivers by design, and the driver that did not
 * record the acceptance reports what it reached instead of failing.
 */
export async function dispatchOperationsWorkflowStart(
  stage: ScoutStage,
  request: OperationsWorkflowStart,
  requestedBy: DiscordAccountId,
): Promise<OperationsDispatchResult> {
  const planned = planStart(stage, request);
  const startRequest: ScoutWorkflowStartRequest = {
    requestedWorkflowId: planned.requestedWorkflowId,
    workflowType: planned.workflowType,
    requestedBy,
    requestSource: planned.requestSource,
    inputPayload: {
      kind: planned.workflowType,
      version: 1,
      data: planned.input,
    },
    requestedAt: IsoInstantSchema.parse(new Date().toISOString()),
  };

  const requested = await requestWorkflowStart(prisma, startRequest);
  if (requested.outcome === "conflict") {
    throw new Error(
      `Workflow start ${planned.requestedWorkflowId} is already requested with a different input (${requested.reason})`,
    );
  }
  const { requestId, acceptance } = requested.record;

  // Reachable only through the lost-insert race: an identical request was
  // recorded AND accepted by a concurrent caller between this call's read and
  // its insert, and the repository adopted it. That request is this one, and
  // its run is Temporal's answer to it, so there is nothing to ask Temporal
  // and nothing this call started. A null run id cannot occur here — only
  // the v1 recorder records acceptances without one, and it never shares a
  // V2 operator Workflow id — so it is a broken contract, not a case.
  if (acceptance !== null) {
    if (acceptance.runId === null) {
      throw new Error(
        `Adopted request ${requestId} for ${planned.requestedWorkflowId} was accepted without a run id`,
      );
    }
    return {
      outcome: "joined-running",
      requestId,
      requestedWorkflowId: planned.requestedWorkflowId,
      runId: acceptance.runId,
    };
  }

  // The same predicate `operations.availability` reports, so the console's
  // enablement and the dispatch's answer can never disagree. A supervisor
  // mid-reconnect is installed but cannot start anything.
  if (!scoutTemporalStartsAvailable()) {
    return {
      outcome: "unavailable",
      requestId,
      requestedWorkflowId: planned.requestedWorkflowId,
    };
  }

  const started = await startOrRefusal(planned);
  if (started === "already-run") {
    return {
      outcome: "already-run",
      requestId,
      requestedWorkflowId: planned.requestedWorkflowId,
    };
  }
  const runId = WorkflowRunIdSchema.parse(started.firstExecutionRunId);
  // The acceptance is recorded for its own sake — it is the evidence the row
  // exists to hold — and its outcome deliberately does not steer the answer
  // below. Which driver's acceptance landed first says who WROTE the evidence,
  // never who created the execution: a caller that truly began the run can
  // still lose that write to an adopter that joined it.
  await recordWorkflowStartAccepted(prisma, {
    requestId,
    acceptedAt: IsoInstantSchema.parse(new Date().toISOString()),
    runId,
  });

  // The one thing about authorship a client can PROVE, and only the negative
  // half of it: a run that a previous accepted request for this Workflow id
  // already recorded existed before this call asked Temporal anything, so this
  // call did not begin it. Every other answer is consistent both with this
  // call beginning the execution and with it joining one that a sandbox
  // starter began a moment earlier, and the SDK does not carry the server's
  // `started` flag that would settle it — so it claims neither.
  const joinedRecordedRun =
    requested.latestAccepted?.acceptance?.runId === runId;
  return {
    outcome: joinedRecordedRun ? "joined-running" : "reached-running",
    requestId,
    requestedWorkflowId: planned.requestedWorkflowId,
    runId,
  };
}
