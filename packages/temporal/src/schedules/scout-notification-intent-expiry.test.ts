import { ScoutBackgroundJobInputSchema } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout notification intent expiry schedule", () => {
  test.each(["beta", "prod"] as const)(
    "runs every five minutes on %s through the background job Workflow",
    (stage) => {
      const schedule = SCHEDULES.find(
        (candidate) =>
          candidate.id === `scout-${stage}-notification-intent-expiry`,
      );

      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: "scoutBackgroundJobWorkflow",
        args: [{ stage, kind: "notification-intent-expiry" }],
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "5 minutes" },
      });
      // The Workflow parses its input with this schema, so a kind the
      // contract does not declare would fail every scheduled run.
      expect(ScoutBackgroundJobInputSchema.parse(schedule?.args[0])).toEqual({
        stage,
        kind: "notification-intent-expiry",
      });
    },
  );
});
