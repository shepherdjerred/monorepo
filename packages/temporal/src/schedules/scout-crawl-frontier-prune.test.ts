import { ScheduleOverlapPolicy } from "@temporalio/client";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { buildSchedulePolicies } from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import { buildScheduleState } from "./schedule-state.ts";

function pruneSchedule(stage: "beta" | "prod") {
  const schedule = SCHEDULES.find(
    (candidate) => candidate.id === `scout-${stage}-crawl-frontier-prune`,
  );
  if (schedule === undefined)
    throw new Error("no crawl-frontier-prune schedule");
  return schedule;
}

describe("Scout crawl frontier prune schedule", () => {
  test.each(["beta", "prod"] as const)(
    "starts the prune workflow every 15 minutes on %s",
    (stage) => {
      const schedule = pruneSchedule(stage);
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: SCOUT_WORKFLOW_NAMES.crawlFrontierPrune,
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "15 minutes" },
      });
      expect(schedule.args).toEqual([{ stage, trigger: "schedule" }]);
    },
  );

  test.each(["beta", "prod"] as const)(
    "skips overlapping runs on %s",
    (stage) => {
      expect(buildSchedulePolicies(pruneSchedule(stage)).overlap).toBe(
        ScheduleOverlapPolicy.SKIP,
      );
    },
  );

  test.each(["beta", "prod"] as const)("is created paused on %s", (stage) => {
    expect(pruneSchedule(stage).initialPauseNote ?? "").not.toBe("");
  });

  test("reconciliation clears the created pause on beta only", () => {
    const beta = pruneSchedule("beta");
    const created = buildScheduleState(beta, {});
    expect(created.paused).toBe(true);
    expect(buildScheduleState(beta, {}, created)).toEqual({ paused: false });

    const prod = pruneSchedule("prod");
    const prodCreated = buildScheduleState(prod, {});
    expect(buildScheduleState(prod, {}, prodCreated)).toEqual(prodCreated);
  });
});
