import { describe, expect, test } from "vitest";
import type {
  WorkflowSignalWithStartInput,
  WorkflowStartInput,
} from "@temporalio/client";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { ExecutionMetadataClientInterceptor } from "./execution-metadata-client-interceptor.ts";

const RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("ExecutionMetadataClientInterceptor", () => {
  test("enriches Workflow starts", async () => {
    const interceptor = new ExecutionMetadataClientInterceptor({
      environment: "prod",
      releaseCommit: RELEASE_COMMIT,
    });
    let received: WorkflowStartInput | undefined;
    await interceptor.startWithDetails(
      {
        workflowType: "agentTaskWorkflow",
        headers: {},
        options: {
          args: [],
          taskQueue: "agent-task",
          workflowId: "test",
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
        },
      },
      (input) => {
        received = input;
        return Promise.resolve({ runId: "run", eagerlyStarted: false });
      },
    );

    expect(received?.options.staticSummary).toBe("Run agentTaskWorkflow");
    expect(received?.options.typedSearchAttributes).toHaveLength(4);
  });

  test("enriches signal-with-start calls", async () => {
    const interceptor = new ExecutionMetadataClientInterceptor({
      environment: "prod",
      releaseCommit: RELEASE_COMMIT,
    });
    let received: WorkflowSignalWithStartInput | undefined;
    await interceptor.signalWithStart(
      {
        workflowType: "reconcileLock",
        signalName: "presenceChanged",
        signalArgs: [],
        headers: {},
        options: {
          args: [],
          taskQueue: "home",
          workflowId: "reconcile-lock",
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
        },
      },
      (input) => {
        received = input;
        return Promise.resolve("run");
      },
    );

    expect(received?.options.staticDetails).toContain("Trigger: `webhook`");
  });
});
