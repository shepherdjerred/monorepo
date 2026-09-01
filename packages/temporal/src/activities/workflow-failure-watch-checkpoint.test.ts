import { describe, expect, it } from "vitest";
import {
  parseWorkflowFailureWatchCheckpoints,
  parseWorkflowFailureWatchLookbackSince,
  serializedCheckpoints,
  workflowExecutionKey,
} from "./workflow-failure-watch-checkpoint.ts";

describe("workflow failure watch heartbeat checkpoints", () => {
  it("preserves a lookback boundary before the first batch checkpoint", () => {
    expect(
      parseWorkflowFailureWatchLookbackSince({
        phase: "pollWorkflowFailures",
        lookbackSince: "2026-07-29T18:00:00.000Z",
      }),
    ).toEqual(new Date("2026-07-29T18:00:00.000Z"));
  });

  it("round-trips checkpoints independently for each monitored namespace", () => {
    const checkpoint = {
      closeTime: new Date("2026-07-30T17:40:00.000Z"),
      startTime: new Date("2026-07-30T17:35:00.000Z"),
      lookbackSince: new Date("2026-07-29T18:00:00.000Z"),
      workflowId: "wf-new",
      runId: "run-new",
      processedExecutionKeys: [workflowExecutionKey("wf-new", "run-new")],
    };

    expect(
      parseWorkflowFailureWatchCheckpoints({
        checkpoints: serializedCheckpoints({
          beta: checkpoint,
          prod: checkpoint,
        }),
      }),
    ).toEqual({ beta: checkpoint, prod: checkpoint });
  });
});
