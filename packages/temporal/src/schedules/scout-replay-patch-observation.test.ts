import { ScoutBackgroundJobInputSchema } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout replay current-patch discovery", () => {
  test.each(["beta", "prod"] as const)(
    "refreshes %s independently of renderer admission",
    (stage) => {
      const schedules = SCHEDULES.filter(
        (candidate) =>
          candidate.id === `scout-${stage}-replay-patch-observation`,
      );
      expect(schedules).toHaveLength(1);
      const schedule = schedules[0];
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: "scoutBackgroundJobWorkflow",
        args: [{ stage, kind: "replay-patch-observation" }],
        timing: { kind: "interval", every: "5 minutes" },
        catchupWindow: "5 minutes",
      });
      expect(schedule?.initialPauseNote).toBeUndefined();
      expect(ScoutBackgroundJobInputSchema.parse(schedule?.args[0])).toEqual({
        stage,
        kind: "replay-patch-observation",
      });
    },
  );
});
