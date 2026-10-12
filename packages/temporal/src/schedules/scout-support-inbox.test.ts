import { ScoutBackgroundJobInputSchema } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout support outbox recovery", () => {
  test.each(["beta", "prod"] as const)(
    "runs each minute on %s without opting into match ownership",
    (stage) => {
      const schedule = SCHEDULES.find(
        (candidate) => candidate.id === `scout-${stage}-support-inbox`,
      );
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: "scoutBackgroundJobWorkflow",
        args: [{ stage, kind: "support-inbox" }],
        timing: { kind: "interval", every: "1 minute" },
      });
      expect(schedule?.initialPauseNote).toBeUndefined();
      expect(ScoutBackgroundJobInputSchema.parse(schedule?.args[0])).toEqual({
        stage,
        kind: "support-inbox",
      });
    },
  );
});
