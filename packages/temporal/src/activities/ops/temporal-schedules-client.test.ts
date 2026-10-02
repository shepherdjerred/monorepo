import { describe, expect, test } from "vitest";
import {
  inspectScheduleHealth,
  type ScheduleHealthReader,
  type ScheduleExecutionObservation,
} from "./temporal-schedules-client.ts";

const now = new Date("2026-10-01T12:00:00Z");
const recent = {
  type: "startWorkflow" as const,
  workflow: { workflowId: "recent", firstExecutionRunId: "first-recent" },
};
const older = {
  type: "startWorkflow" as const,
  workflow: { workflowId: "older", firstExecutionRunId: "first-older" },
};

function reader(status: ScheduleExecutionObservation["status"]): {
  client: ScheduleHealthReader;
  reads: string[];
} {
  const reads: string[] = [];
  const client: ScheduleHealthReader = {
    list: () =>
      (async function* () {
        yield { scheduleId: "backup" };
      })(),
    describeSchedule: () =>
      Promise.resolve({
        action: {
          type: "startWorkflow",
          workflowType: "runBackup",
          taskQueue: "infra",
          workflowId: "backup",
        },
        state: { paused: false },
        info: {
          recentActions: [{ scheduledAt: now, takenAt: now, action: recent }],
          nextActionTimes: [now],
          numActionsTaken: 20,
          numActionsMissedCatchupWindow: 0,
          numActionsSkippedOverlap: 0,
          createdAt: now,
          lastUpdatedAt: undefined,
          runningActions: [recent, older],
        },
      }),
    describeExecution: (id, first) => {
      reads.push(`${id}:${first}`);
      return Promise.resolve({
        status: id === "recent" ? "COMPLETED" : status,
      });
    },
  };
  return { client, reads };
}

describe("Temporal Schedule SDK boundary", () => {
  test("describes executions and rejects stale cached running state", async () => {
    const { client, reads } = reader("COMPLETED");
    const result = await inspectScheduleHealth(client, "prod", now);
    expect(result[0]).toMatchObject({
      running: false,
      actions: [{ status: "COMPLETED", scheduledAt: now.toISOString() }],
    });
    expect(reads).toEqual(["recent:first-recent", "older:first-older"]);
  });
  test("an older running action outside the recent-action ring prevents Idle", async () => {
    const observations = await inspectScheduleHealth(
      reader("RUNNING").client,
      "prod",
      now,
    );
    expect(observations[0]?.running).toBe(true);
  });
  test("missing cached running evidence is unknown rather than Idle", async () => {
    const observations = await inspectScheduleHealth(
      reader("MISSING").client,
      "prod",
      now,
    );
    expect(observations[0]?.running).toBeNull();
  });
  test("other execution API failures fail the isolated Temporal source", async () => {
    const { client } = reader("COMPLETED");
    client.describeExecution = () =>
      Promise.reject(new Error("permission denied"));
    await expect(inspectScheduleHealth(client, "prod", now)).rejects.toThrow(
      "permission denied",
    );
  });
});
