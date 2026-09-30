import { ScheduleOverlapPolicy } from "@temporalio/client";
import { ScoutBackgroundJobInputSchema } from "@scout-for-lol/temporal";
import { scoutPipelineReconciliationV2InputCodec } from "@scout-for-lol/temporal/workflow-contracts-v2";
import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

const PAUSE_NOTE =
  "Paused until the matching Scout Temporal feature family is enabled and legacy work is drained";

describe("Scout progression and V2 pipeline reconciliation schedules", () => {
  test.each(["beta", "prod"] as const)(
    "declares paused one-minute cutover schedules for %s",
    (stage) => {
      const progression = SCHEDULES.find(
        (candidate) =>
          candidate.id === `scout-${stage}-progression-reconciliation`,
      );
      expect(progression).toMatchObject({
        namespace: stage,
        workflowType: "scoutBackgroundJobWorkflow",
        args: [{ stage, kind: "progression-reconciliation" }],
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "1 minute" },
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: "5 minutes",
      });
      expect(progression?.initialPauseNote).toBe(PAUSE_NOTE);
      expect(ScoutBackgroundJobInputSchema.parse(progression?.args[0])).toEqual(
        { stage, kind: "progression-reconciliation" },
      );

      const pipeline = SCHEDULES.find(
        (candidate) =>
          candidate.id === `scout-${stage}-pipeline-reconciliation-v2`,
      );
      expect(pipeline).toMatchObject({
        namespace: stage,
        workflowType: "scoutPipelineReconciliationV2Workflow",
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "1 minute" },
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: "5 minutes",
      });
      expect(pipeline?.initialPauseNote).toBe(PAUSE_NOTE);
      expect(
        scoutPipelineReconciliationV2InputCodec.parse(pipeline?.args[0]),
      ).toEqual({ stage, trigger: "schedule" });
    },
  );
});
