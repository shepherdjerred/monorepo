import { describe, expect, it } from "vitest";
import {
  parseWorkflowFailureWatchCheckpoint,
  parseWorkflowFailureWatchCheckpoints,
  parseWorkflowFailureWatchLookbackSince,
  serializedCheckpoints,
  serializedCheckpoint,
  workflowExecutionKey,
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

  it("preserves a lookback boundary before the first batch checkpoint", () => {
    expect(
      parseWorkflowFailureWatchLookbackSince({
        phase: "pollWorkflowFailures",
        lookbackSince: "2026-07-29T18:00:00.000Z",
      }),
    ).toEqual(new Date("2026-07-29T18:00:00.000Z"));
  });

  it("serializes and parses a checkpoint with an ISO close time", () => {
    const serialized = serializedCheckpoint({
      detailedAlertsConsumed: 16,
      cursor: {
        closeTime: new Date("2026-07-30T17:40:00.000Z"),
        startTime: new Date("2026-07-30T17:35:00.000Z"),
        lookbackSince: new Date("2026-07-29T18:00:00.000Z"),
        workflowId: "wf-new",
        runId: "run-new",
        processedExecutionKeys: [workflowExecutionKey("wf-new", "run-new")],
      },
    });

    expect(
      parseWorkflowFailureWatchCheckpoint({ checkpoint: serialized }),
    ).toEqual({
      detailedAlertsConsumed: 16,
      cursor: {
        closeTime: new Date("2026-07-30T17:40:00.000Z"),
        startTime: new Date("2026-07-30T17:35:00.000Z"),
        lookbackSince: new Date("2026-07-29T18:00:00.000Z"),
        workflowId: "wf-new",
        runId: "run-new",
        processedExecutionKeys: [workflowExecutionKey("wf-new", "run-new")],
      },
    });
  });

  it("upgrades a legacy cursor with an empty consumed budget", () => {
    expect(
      parseWorkflowFailureWatchCheckpoint({
        checkpoint: {
          closeTime: "2026-07-30T17:40:00.000Z",
          workflowId: "wf-legacy",
          runId: "run-legacy",
        },
      }),
    ).toMatchObject({
      detailedAlertsConsumed: 0,
      cursor: { workflowId: "wf-legacy", runId: "run-legacy" },
    });
  });

  it("fails loudly for malformed checkpoint details", () => {
    expect(() =>
      parseWorkflowFailureWatchCheckpoint({
        checkpoint: {
          closeTime: "not-a-date",
          startTime: "2026-07-30T17:35:00.000Z",
          workflowId: "wf-new",
          runId: "run-new",
        },
      }),
    ).toThrow();
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
          default: checkpoint,
        }),
      }),
    ).toEqual({ beta: checkpoint, default: checkpoint });
  });
});
