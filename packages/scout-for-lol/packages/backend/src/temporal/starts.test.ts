import { describe, expect, test } from "vitest";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowStartOptions,
} from "@temporalio/client";
import {
  startScoutGatewayReadyIngestionReconciliation,
  type ScoutWorkflowStarter,
} from "#src/temporal/starts.ts";

type RecordedStart = {
  readonly workflowType: string;
  readonly options: WorkflowStartOptions;
};

/**
 * The starter's parameter type is structural precisely so this can be a plain
 * object: the real Temporal Client satisfies it, and a test needs no `as`
 * cast and no mock framework to build one.
 */
function fakeStarter(failWith?: () => Error) {
  const starts: RecordedStart[] = [];
  const client: ScoutWorkflowStarter = {
    workflow: {
      start: (workflowType, options) => {
        starts.push({ workflowType, options });
        if (failWith !== undefined) return Promise.reject(failWith());
        return Promise.resolve(undefined);
      },
    },
  };
  return { client, starts };
}

describe("startScoutGatewayReadyIngestionReconciliation", () => {
  test("starts the reconciliation workflow with the gateway-ready trigger", async () => {
    const { client, starts } = fakeStarter();

    await startScoutGatewayReadyIngestionReconciliation(client, "beta");

    expect(starts).toHaveLength(1);
    const [start] = starts;
    expect(start?.workflowType).toBe("scoutIngestionReconciliationWorkflow");
    expect(start?.options.workflowId).toBe(
      "scout-beta-ingestion-reconciliation-gateway-ready",
    );
    expect(start?.options.taskQueue).toBe("scout-beta");
    expect(start?.options.args).toEqual([
      { stage: "beta", trigger: "gateway-ready" },
    ]);
  });

  test("lets a repeat boot start a new run after a completed one", async () => {
    const { client, starts } = fakeStarter();

    await startScoutGatewayReadyIngestionReconciliation(client, "prod");

    const [start] = starts;
    expect(start?.options.workflowIdReusePolicy).toBe(
      WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    );
    expect(start?.options.workflowIdConflictPolicy).toBe(
      WorkflowIdConflictPolicy.USE_EXISTING,
    );
  });

  test("treats an already-running reconciliation as success", async () => {
    const { client } = fakeStarter(
      () =>
        new WorkflowExecutionAlreadyStartedError(
          "Workflow execution already started",
          "scout-beta-ingestion-reconciliation-gateway-ready",
          "scoutIngestionReconciliationWorkflow",
        ),
    );

    await expect(
      startScoutGatewayReadyIngestionReconciliation(client, "beta"),
    ).resolves.toBeUndefined();
  });

  test("propagates other start failures so the caller can warn", async () => {
    const { client } = fakeStarter(() => new Error("temporal unavailable"));

    await expect(
      startScoutGatewayReadyIngestionReconciliation(client, "beta"),
    ).rejects.toThrow("temporal unavailable");
  });
});
