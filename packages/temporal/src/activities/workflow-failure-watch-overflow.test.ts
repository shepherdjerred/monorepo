import { describe, expect, it } from "vitest";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import {
  addWorkflowFailureOverflowBatch,
  buildWorkflowFailureOverflowAlert,
} from "./workflow-failure-watch-overflow.ts";

const OBSERVED_AT = new Date("2026-07-30T18:00:00.000Z");

function execution(
  index: number,
  workflowType: string,
): FailedWorkflowExecution {
  return {
    workflowId: `workflow-${String(index)}`,
    runId: `run-${String(index)}`,
    temporalNamespace: "prod",
    workflowType,
    taskQueue: "default",
    startTime: new Date(OBSERVED_AT.getTime() - (index + 1) * 1000),
    closeTime: new Date(OBSERVED_AT.getTime() - index * 1000),
    status: index % 2 === 0 ? "FAILED" : "TIMED_OUT",
  };
}

describe("workflow failure overflow summary", () => {
  it("retains totals and counts when omitted executions arrive in batches", () => {
    const firstBatch = Array.from({ length: 25 }, (_, index) =>
      execution(index, "syncGolinks"),
    );
    const secondBatch = Array.from({ length: 26 }, (_, index) =>
      execution(index + 25, "agentTaskWorkflow"),
    );

    const summary = addWorkflowFailureOverflowBatch(
      addWorkflowFailureOverflowBatch(undefined, firstBatch),
      secondBatch,
    );
    const alert = buildWorkflowFailureOverflowAlert(
      summary,
      new Date("2026-07-29T18:00:00.000Z"),
      OBSERVED_AT,
      86_400_000,
    );

    expect(summary).toMatchObject({
      omitted: 51,
      newestOmittedCloseTime: firstBatch[0]?.closeTime,
    });
    expect(summary.counts).toEqual({
      "agentTaskWorkflow / TIMED_OUT": 13,
      "agentTaskWorkflow / FAILED": 13,
      "syncGolinks / FAILED": 13,
      "syncGolinks / TIMED_OUT": 12,
    });
    expect(alert.annotations["description"]).toContain(
      "51 failed Temporal workflow executions were omitted",
    );
  });
});
