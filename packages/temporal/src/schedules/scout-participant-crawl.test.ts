import { ScheduleOverlapPolicy } from "@temporalio/client";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal";
import { describe, expect, test } from "vitest";
import { buildSchedulePolicies } from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import { SCOUT_SCHEDULES } from "./scout-schedule-definitions.ts";

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

  test.each(["beta", "prod"] as const)("is created paused on %s", (stage) => {
    expect(crawlSchedule(stage).initialPauseNote ?? "").not.toBe("");
  });

  test.each(["beta", "prod"] as const)(
    "reconciliation clears the crawl pause on %s",
    (stage) => {
      const schedule = crawlSchedule(stage);
      expect(schedule.retiredPauseNotes).toContain(schedule.initialPauseNote);
    },
  );

  test("only the crawl's pause is retired in production", () => {
    const prod = SCOUT_SCHEDULES.filter(
      (candidate) => candidate.namespace === "prod",
    );
    const retiring = prod.filter(
      (candidate) => candidate.retiredPauseNotes !== undefined,
    );
    expect(retiring.map((candidate) => candidate.id)).toEqual([
      "scout-prod-participant-crawl",
    ]);
  });
});
