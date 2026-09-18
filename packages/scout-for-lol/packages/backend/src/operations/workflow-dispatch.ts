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
 */

export type OperationsWorkflowStart =
  | { readonly kind: "reconcile-pipeline" }
  | { readonly kind: "repair-projection"; readonly riotMatchId: RiotMatchId }
  | {
      readonly kind: "retry-notification";
      readonly intentKey: NotificationIntentKey;
    };

export type OperationsDispatchResult =
  /** The request was recorded and Temporal began a NEW execution for it. */
  | {
      readonly outcome: "started";
      readonly requestId: WorkflowStartRequestId;
      readonly requestedWorkflowId: string;
      readonly runId: string;
    }
  /**
   * The request was recorded and accepted, but no new execution began: an
   * execution for this Workflow id was still running, and the conflict policy
   * joined it. The run reported is that execution's — the same one the
   * previous accepted request for this id recorded, which is how the join is
   * known. Reporting this as `started` would claim an effect that did not
   * happen.
   *
   * Also the answer when a concurrent confirmation of the identical start won
   * the durable race and was accepted before this one could record itself:
   * this request adopted that one, whose run is already running.
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
 * @throws when a durable write conflicts — a different start already claims
 * this Workflow id, or a different acceptance already claims this request.
 * Those are broken contracts rather than expected operator outcomes.
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
  const accepted = await recordWorkflowStartAccepted(prisma, {
    requestId,
    acceptedAt: IsoInstantSchema.parse(new Date().toISOString()),
    runId,
  });
  if (accepted.outcome === "conflict") {
    throw new Error(
      `Workflow start request ${requestId} for ${planned.requestedWorkflowId} was accepted as a different run (${accepted.reason})`,
    );
  }
  // Run ids are unique per execution, so Temporal answering with the run the
  // previous accepted request recorded means that execution is still running
  // and the conflict policy joined it. Anything else is a run this request
  // began.
  const joined = requested.latestAccepted?.acceptance?.runId === runId;
  return {
    outcome: joined ? "joined-running" : "started",
    requestId,
    requestedWorkflowId: planned.requestedWorkflowId,
    runId,
  };
}
