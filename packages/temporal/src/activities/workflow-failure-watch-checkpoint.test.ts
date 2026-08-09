import { describe, expect, it } from "bun:test";
import {
  parseWorkflowFailureWatchCheckpoint,
  serializedCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";

describe("workflow failure watch heartbeat checkpoints", () => {
  it("accepts legacy heartbeat details without a checkpoint", () => {
    expect(
      parseWorkflowFailureWatchCheckpoint({
        phase: "pollWorkflowFailures",
        elapsedMs: 10_000,
      }),
    ).toBeUndefined();
  });

  it("serializes and parses a checkpoint with an ISO close time", () => {
    const serialized = serializedCheckpoint({
      closeTime: new Date("2026-07-30T17:40:00.000Z"),
      workflowId: "wf-new",
      runId: "run-new",
    });

    expect(
      parseWorkflowFailureWatchCheckpoint({ checkpoint: serialized }),
    ).toEqual({
      closeTime: new Date("2026-07-30T17:40:00.000Z"),
      workflowId: "wf-new",
      runId: "run-new",
    });
  });

  it("fails loudly for malformed checkpoint details", () => {
    expect(() =>
      parseWorkflowFailureWatchCheckpoint({
        checkpoint: {
          closeTime: "not-a-date",
          workflowId: "wf-new",
          runId: "run-new",
        },
      }),
    ).toThrow();
  });
});
