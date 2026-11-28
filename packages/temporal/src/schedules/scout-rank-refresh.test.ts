import { ScheduleOverlapPolicy } from "@temporalio/client";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { buildSchedulePolicies } from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import { buildScheduleState } from "./schedule-state.ts";

function rankRefreshSchedule(stage: "beta" | "prod") {
  const schedule = SCHEDULES.find(
    (candidate) => candidate.id === `scout-${stage}-rank-refresh`,
  );
  if (schedule === undefined) throw new Error("no rank-refresh schedule");
  return schedule;
}

describe("Scout rank refresh schedule", () => {
  test.each(["beta", "prod"] as const)(
    "starts the refresh workflow daily on the %s Scout queue",
    (stage) => {
      const schedule = rankRefreshSchedule(stage);
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: SCOUT_WORKFLOW_NAMES.rankRefresh,
        taskQueue: `scout-${stage}`,
        timing: { kind: "cron", expression: "0 5 * * *", timezone: "UTC" },
      });
      expect(schedule.args).toEqual([{ stage, trigger: "schedule" }]);
    },
  );

  test.each(["beta", "prod"] as const)(
    "skips overlapping runs on %s",
    (stage) => {
      expect(buildSchedulePolicies(rankRefreshSchedule(stage)).overlap).toBe(
        ScheduleOverlapPolicy.SKIP,
      );
    },
  );

  test.each(["beta", "prod"] as const)("is created paused on %s", (stage) => {
    expect(rankRefreshSchedule(stage).initialPauseNote ?? "").toContain(
      "scoutRankRefreshWorkflow",
    );
  });

  test("reconciliation clears the created pause on beta only", () => {
    const beta = rankRefreshSchedule("beta");
    const created = buildScheduleState(beta, {});
    expect(created.paused).toBe(true);
    expect(buildScheduleState(beta, {}, created)).toEqual({ paused: false });

    const prod = rankRefreshSchedule("prod");
    const prodCreated = buildScheduleState(prod, {});
    expect(buildScheduleState(prod, {}, prodCreated)).toEqual(prodCreated);
  });
});
