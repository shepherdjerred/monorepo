import { ScheduleOverlapPolicy } from "@temporalio/client";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { buildSchedulePolicies } from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";

function crawlSchedule(stage: "beta" | "prod") {
  const schedule = SCHEDULES.find(
    (candidate) => candidate.id === `scout-${stage}-participant-crawl`,
  );
  if (schedule === undefined) throw new Error("no participant-crawl schedule");
  return schedule;
}

describe("Scout participant crawl schedule", () => {
  test.each(["beta", "prod"] as const)(
    "starts the crawl workflow every minute on %s",
    (stage) => {
      const schedule = crawlSchedule(stage);
      expect(schedule).toMatchObject({
        namespace: stage,
        workflowType: SCOUT_WORKFLOW_NAMES.participantCrawl,
        taskQueue: `scout-${stage}`,
        timing: { kind: "interval", every: "1 minute" },
      });
      expect(schedule.workflowType).toBe("scoutParticipantCrawlWorkflow");
      expect(schedule.args).toEqual([{ stage, trigger: "schedule" }]);
    },
  );

  test.each(["beta", "prod"] as const)(
    "skips overlapping ticks on %s",
    (stage) => {
      expect(buildSchedulePolicies(crawlSchedule(stage)).overlap).toBe(
        ScheduleOverlapPolicy.SKIP,
      );
    },
  );

  test.each(["beta", "prod"] as const)(
    "is created paused on %s until the enablement PR",
    (stage) => {
      const schedule = crawlSchedule(stage);
      expect(schedule.initialPauseNote).toBeDefined();
      expect(schedule.retiredPauseNotes ?? []).not.toContain(
        schedule.initialPauseNote,
      );
    },
  );
});
