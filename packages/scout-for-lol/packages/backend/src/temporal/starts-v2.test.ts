import { describe, expect, test } from "vitest";
import {
  WorkflowExecutionAlreadyStartedError,
  type WorkflowStartOptions,
} from "@temporalio/client";
import {
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
} from "@scout-for-lol/temporal";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  startScoutLakeProjectionV2,
  startScoutNotificationV2,
  startScoutPipelineReconciliationV2,
  type ScoutV2WorkflowStarter,
} from "#src/temporal/starts-v2.ts";

/**
 * What an operator start is allowed to re-run.
 *
 * The property under test is not "some policy is sent" but "the policy sent is
 * the one that admits the re-run this operation exists to perform". A
 * notification intent that an operator has just released from
 * `unknown-delivery` MUST get a fresh run even though the previous execution
 * COMPLETED, and a projection must re-run after a failure but not after a
 * success. Those are opposite answers, so a single uniform policy is wrong for
 * at least one of them whichever one is chosen.
 *
 * The fake below models Temporal's documented ID-reuse rule rather than calling
 * a server: closed executions are admitted or refused per the reuse policy, and
 * an open one is joined per the conflict policy. That is a MODEL, and it is
 * stated as one — it pins the policy this code sends and what that policy
 * means, not Temporal's implementation of it.
 */

type ExecutionStatus = "running" | "completed" | "failed";

type RecordedStart = {
  readonly workflowType: string;
  readonly options: WorkflowStartOptions;
  readonly runId: string;
};

function fakeTemporal() {
  const executions = new Map<string, ExecutionStatus>();
  const starts: RecordedStart[] = [];
  let runSeq = 0;

  function admitsClosedRun(
    reuse: WorkflowStartOptions["workflowIdReusePolicy"],
    closed: ExecutionStatus,
  ): boolean {
    if (reuse === "ALLOW_DUPLICATE") return true;
    if (reuse === "ALLOW_DUPLICATE_FAILED_ONLY") return closed === "failed";
    return false;
  }

  const client: ScoutV2WorkflowStarter = {
    workflow: {
      start: (workflowType, options) => {
        const workflowId = options.workflowId;
        const existing = executions.get(workflowId);
        if (existing === "running") {
          if (options.workflowIdConflictPolicy !== "USE_EXISTING") {
            return Promise.reject(
              new WorkflowExecutionAlreadyStartedError(
                "Workflow execution already started",
                workflowId,
                workflowType,
              ),
            );
          }
          const joined = starts.findLast(
            (start) => start.options.workflowId === workflowId,
          );
          if (joined === undefined) {
            throw new Error(`no recorded run to join for ${workflowId}`);
          }
          return Promise.resolve({ firstExecutionRunId: joined.runId });
        }
        if (
          existing !== undefined &&
          !admitsClosedRun(options.workflowIdReusePolicy, existing)
        ) {
          return Promise.reject(
            new WorkflowExecutionAlreadyStartedError(
              "Workflow execution already started",
              workflowId,
              workflowType,
            ),
          );
        }
        runSeq += 1;
        const runId = `run-${runSeq.toString()}`;
        executions.set(workflowId, "running");
        starts.push({ workflowType, options, runId });
        return Promise.resolve({ firstExecutionRunId: runId });
      },
    },
  };

  return {
    client,
    starts,
    close: (workflowId: string, as: "completed" | "failed") => {
      executions.set(workflowId, as);
    },
  };
}

const INTENT_KEY = NotificationIntentKeySchema.parse(
  "notification:NA1_5312279829:channel:420003",
);
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5312279829");
const NOTIFICATION_ID = `scout-beta-notification-v2-${INTENT_KEY}`;
const PROJECTION_ID = `scout-beta-lake-projection-v2-${MATCH_ID}`;

async function startNotification(client: ScoutV2WorkflowStarter) {
  return await startScoutNotificationV2(client, {
    stage: "beta",
    intentKey: INTENT_KEY,
  });
}

async function startProjection(client: ScoutV2WorkflowStarter) {
  return await startScoutLakeProjectionV2(client, {
    stage: "beta",
    riotMatchId: MATCH_ID,
  });
}

describe("operator starts share the sweep's per-family reuse policies", () => {
  test("each start sends exactly the shared table's policy for its family", async () => {
    // The drift guard. A policy spelled here a second time rather than read
    // from the table would pass every behavioural test below and still diverge
    // from the sweep the day the table changes.
    const { client, starts } = fakeTemporal();

    await startNotification(client);
    await startProjection(client);

    const [notification, projection] = starts;
    expect(notification?.options.workflowIdReusePolicy).toBe(
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notificationV2],
    );
    expect(projection?.options.workflowIdReusePolicy).toBe(
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjectionV2],
    );
  });

  test("every operator start joins a run already in flight", async () => {
    const { client, starts } = fakeTemporal();

    const first = await startNotification(client);
    const second = await startNotification(client);

    expect(second.firstExecutionRunId).toBe(first.firstExecutionRunId);
    expect(starts).toHaveLength(1);
  });
});

describe("notification and projection answer reuse differently", () => {
  test("a notification re-drives after a SUCCESSFUL run", async () => {
    // The retry arm's main path: the previous execution SUCCEEDED — recording
    // `unknown-delivery` is a legitimate completion, not a failure — and the
    // operator has since resolved the ambiguity as not-delivered, releasing the
    // intent to `ready`. The fresh run computes the same deterministic ID, so a
    // policy that refused reuse after success would make the arm unusable.
    const temporal = fakeTemporal();
    const first = await startNotification(temporal.client);
    temporal.close(NOTIFICATION_ID, "completed");

    const second = await startNotification(temporal.client);

    expect(second.firstExecutionRunId).not.toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(2);
  });

  test("a projection re-runs after a FAILED run", async () => {
    const temporal = fakeTemporal();
    const first = await startProjection(temporal.client);
    temporal.close(PROJECTION_ID, "failed");

    const second = await startProjection(temporal.client);

    expect(second.firstExecutionRunId).not.toBe(first.firstExecutionRunId);
    expect(temporal.starts).toHaveLength(2);
  });

  test("a projection that SUCCEEDED is refused rather than re-run", async () => {
    // A staged projection has nothing left to do; re-running it would repeat a
    // phase the durable receipts already attest to.
    const temporal = fakeTemporal();
    await startProjection(temporal.client);
    temporal.close(PROJECTION_ID, "completed");

    await expect(startProjection(temporal.client)).rejects.toBeInstanceOf(
      WorkflowExecutionAlreadyStartedError,
    );
    expect(temporal.starts).toHaveLength(1);
  });
});

describe("operator reconciliation keeps its own reuse terms", () => {
  test("a closed operator sweep is not silently re-run", async () => {
    // Reconciliation is absent from the shared table on purpose: nothing
    // re-drives it, and its one-shot-per-trigger behaviour is the
    // ScoutWorkflowStart schema limit tracked on SJ-205, not a policy to loosen.
    const temporal = fakeTemporal();
    await startScoutPipelineReconciliationV2(temporal.client, {
      stage: "beta",
      trigger: "operator",
    });
    const [start] = temporal.starts;
    expect(start?.options.workflowIdReusePolicy).toBe("REJECT_DUPLICATE");
    expect(start?.options.workflowId).toBe(
      "scout-beta-pipeline-reconciliation-v2-operator",
    );

    temporal.close(
      "scout-beta-pipeline-reconciliation-v2-operator",
      "completed",
    );

    await expect(
      startScoutPipelineReconciliationV2(temporal.client, {
        stage: "beta",
        trigger: "operator",
      }),
    ).rejects.toBeInstanceOf(WorkflowExecutionAlreadyStartedError);
  });
});
