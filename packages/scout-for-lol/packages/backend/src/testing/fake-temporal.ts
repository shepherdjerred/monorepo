import {
  WorkflowExecutionAlreadyStartedError,
  type WorkflowStartOptions,
} from "@temporalio/client";
import type { ScoutPipelineWorkflowStarter } from "#src/temporal/pipeline-starts.ts";

/**
 * A model of Temporal's documented Workflow-ID rules for the V2 operator
 * starts, in place of a server: closed executions are admitted or refused per
 * the reuse policy sent, and an open one is joined per the conflict policy.
 * It is a MODEL and is stated as one — it pins the policy this code sends and
 * what that policy means, not Temporal's implementation of it.
 */

export type FakeExecutionStatus = "running" | "completed" | "failed";

export type FakeRecordedStart = {
  readonly workflowType: string;
  readonly options: WorkflowStartOptions;
  readonly runId: string;
};

export type FakeTemporal = {
  readonly client: ScoutPipelineWorkflowStarter;
  readonly starts: FakeRecordedStart[];
  readonly close: (workflowId: string, as: "completed" | "failed") => void;
};

function admitsClosedRun(
  reuse: WorkflowStartOptions["workflowIdReusePolicy"],
  closed: FakeExecutionStatus,
): boolean {
  return (
    reuse === "ALLOW_DUPLICATE" ||
    (reuse === "ALLOW_DUPLICATE_FAILED_ONLY" && closed === "failed")
  );
}

export function fakeTemporal(): FakeTemporal {
  const executions = new Map<string, FakeExecutionStatus>();
  const starts: FakeRecordedStart[] = [];
  let runSeq = 0;

  const client: ScoutPipelineWorkflowStarter = {
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
    close: (workflowId, as) => {
      executions.set(workflowId, as);
    },
  };
}
