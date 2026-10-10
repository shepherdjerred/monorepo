import { ScheduleOverlapPolicy } from "@temporalio/client";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal";
import { scoutPrematchDiscoveryInputCodec } from "@scout-for-lol/temporal/workflow-contracts";
import { describe, expect, test } from "vitest";
import { buildSchedulePolicies } from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout prematch poll schedule", () => {
  test.each(["beta", "prod"] as const)(
    "starts V2 prematch discovery every 30 seconds on %s",
    (stage) => {
      const schedule = SCHEDULES.find(
        (candidate) => candidate.id === `scout-${stage}-prematch-poll`,
      );
      if (schedule === undefined) throw new Error("no prematch-poll schedule");

      // V2 owns detection and runs the prematch maintenance sweeps itself, so
      // the Schedule starts it directly; v1's realtime poll is not started.
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: SCOUT_WORKFLOW_NAMES.prematchDiscovery,
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "30 seconds" },
      });
      expect(schedule.workflowType).toBe("scoutPrematchDiscoveryWorkflow");
      expect(schedule.args).toEqual([
        scoutPrematchDiscoveryInputCodec.serialize({ stage }),
      ]);
      expect(scoutPrematchDiscoveryInputCodec.parse(schedule.args[0])).toEqual({
        stage,
      });
    },
  );

  test.each(["beta", "prod"] as const)(
    "skips overlapping polls and late ones on %s",
    (stage) => {
      const schedule = SCHEDULES.find(
        (candidate) => candidate.id === `scout-${stage}-prematch-poll`,
      );
      if (schedule === undefined) throw new Error("no prematch-poll schedule");

      // A poll that outlives its interval drops the tick behind it, and a
      // tick the server missed by over a minute is not replayed: a late
      // game-start announcement is worth nothing. This replaced v1's 90s
      // staleness check inside the Workflow.
      expect(buildSchedulePolicies(schedule)).toEqual({
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: "1 minute",
      });
    },
  );
});
