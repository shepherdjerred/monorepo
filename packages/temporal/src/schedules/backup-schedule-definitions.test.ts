import { ScheduleOverlapPolicy } from "@temporalio/client";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { BACKUP_SCHEDULES } from "./backup-schedule-definitions.ts";

describe("SeaweedFS backup schedules", () => {
  it("registers paused Pacific schedules on the central Workflow queue", () => {
    expect(BACKUP_SCHEDULES).toHaveLength(3);
    for (const schedule of BACKUP_SCHEDULES) {
      expect(schedule.taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
      expect(schedule.overlap).toBe(ScheduleOverlapPolicy.SKIP);
      expect(schedule.initialPauseNote).toContain("acceptance restores");
      if (schedule.timing.kind !== "cron") {
        throw new TypeError("Backup schedules must use cron timing");
      }
      expect(schedule.timing.timezone).toBe("America/Los_Angeles");
    }
  });

  it("uses the planned cadence expressions", () => {
    expect(
      BACKUP_SCHEDULES.map((schedule) =>
        schedule.timing.kind === "cron" ? schedule.timing.expression : "",
      ),
    ).toEqual(["0 */6 * * *", "30 11 * * *", "0 14 * * 0"]);
  });
});
