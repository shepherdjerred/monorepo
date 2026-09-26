import { ScoutBackgroundJobInputSchema } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout MVP tally refresh schedule", () => {
  test.each(["beta", "prod"] as const)(
    "sweeps durable requests each minute on %s",
    (stage) => {
      const schedule = SCHEDULES.find(
        (candidate) => candidate.id === `scout-${stage}-mvp-tally-refresh`,
      );
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: "scoutBackgroundJobWorkflow",
        args: [{ stage, kind: "mvp-tally-refresh" }],
        timing: { kind: "interval", every: "1 minute" },
      });
      expect(schedule?.initialPauseNote).toBeUndefined();
      expect(ScoutBackgroundJobInputSchema.parse(schedule?.args[0])).toEqual({
        stage,
        kind: "mvp-tally-refresh",
      });
    },
  );
});
