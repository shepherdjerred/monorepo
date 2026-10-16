import {
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import { describe, expect, test, vi } from "vitest";
import {
  inspectScheduleHealth,
  listCompletedScheduleActions,
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
    withReadScope: (_scope, operation) => operation(),
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
    listCompletedActions: () =>
      Promise.resolve([
        {
          scheduleId: "backup",
          scheduledAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          workflowId: "older-completed",
        },
      ]),
  };
  return { client, reads };
}

describe("Temporal Schedule SDK read budget", () => {
  test("direct audit callers bound schedule and nested execution reads to eight", async () => {
    const { client } = reader("COMPLETED");
    let active = 0;
    let maximum = 0;
    const observeRead = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
    };
    client.list = async function* () {
      for (let index = 0; index < 32; index += 1) {
        yield { scheduleId: `schedule-${String(index)}` };
      }
    };
    const describeSchedule = client.describeSchedule;
    client.describeSchedule = async (scheduleId) => {
      await observeRead();
      const description = await describeSchedule(scheduleId);
      return {
        ...description,
        info: {
          ...description.info,
          runningActions: [],
          recentActions: Array.from({ length: 12 }, (_, index) => ({
            scheduledAt: now,
            takenAt: now,
            action: {
              ...recent,
              workflow: {
                workflowId: `${scheduleId}-${String(index)}`,
                firstExecutionRunId: `first-${scheduleId}-${String(index)}`,
              },
            },
          })),
        },
      };
    };
    client.describeExecution = async () => {
      await observeRead();
      return { status: "COMPLETED" };
    };
    const observations = await inspectScheduleHealth(client, "prod", now);
    expect(observations).toHaveLength(32);
    expect(observations.every((entry) => entry.actions.length === 12)).toBe(
      true,
    );
    expect(maximum).toBe(8);
  });
});

describe("Temporal Schedule SDK boundary", () => {
  test("describes executions and rejects stale cached running state", async () => {
    const { client, reads } = reader("COMPLETED");
    const result = await inspectScheduleHealth(client, "prod", now);
    expect(result[0]).toMatchObject({
      running: false,
      actions: [{ status: "COMPLETED", scheduledAt: now.toISOString() }],
      completedActions: [
        {
          scheduledAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          workflowId: "older-completed",
        },
      ],
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
  test("schedule query failures identify the namespace and schedule and retain the cause", async () => {
    const { client } = reader("COMPLETED");
    const error = new Error("no poller seen for task queue recently");
    client.describeSchedule = () => Promise.reject(error);
    await expect(
      inspectScheduleHealth(client, "beta", now),
    ).rejects.toMatchObject({
      message:
        "Temporal schedule beta/backup: no poller seen for task queue recently",
      cause: error,
    });
  });
  test("lists successful schedule executions by durable schedule and scheduled time", async () => {
    const scheduledAt = new Date(now.getTime() - 60 * 60 * 1000);
    const list = vi.fn(() =>
      (async function* () {
        yield {
          workflowId: "backup-older-action",
          closeTime: scheduledAt,
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: defineSearchAttributeKey("TemporalScheduledById", "KEYWORD"),
              value: "backup",
            },
            {
              key: defineSearchAttributeKey(
                "TemporalScheduledStartTime",
                "DATETIME",
              ),
              value: scheduledAt,
            },
          ]),
        };
      })(),
    );
    const result = await listCompletedScheduleActions(
      list,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
    );
    expect(list).toHaveBeenCalledWith({
      pageSize: 100,
      query:
        'TemporalScheduledById IS NOT NULL AND TemporalScheduledStartTime > "2026-09-30T12:00:00.000Z" AND ExecutionStatus = "Completed"',
    });
    expect(result).toEqual([
      {
        scheduleId: "backup",
        scheduledAt: scheduledAt.toISOString(),
        workflowId: "backup-older-action",
        closedAt: scheduledAt.toISOString(),
      },
    ]);
  });
  test("one namespace scan groups completions and deduplicates execution reads", async () => {
    const { client, reads } = reader("COMPLETED");
    client.list = async function* () {
      yield { scheduleId: "backup" };
      yield { scheduleId: "other" };
    };
    const scan = vi.fn(client.listCompletedActions);
    client.listCompletedActions = scan;
    const result = await inspectScheduleHealth(client, "prod", now);
    expect(scan).toHaveBeenCalledExactlyOnceWith(
      new Date("2026-09-30T12:00:00Z"),
    );
    expect(
      result.map((entry) => [entry.scheduleId, entry.completedActions.length]),
    ).toEqual([
      ["backup", 1],
      ["other", 0],
    ]);
    expect(reads).toEqual(["recent:first-recent", "older:first-older"]);
  });
  test("namespace scans consume every page and reject missing schedule attributes", async () => {
    const list = vi.fn(() =>
      (async function* () {
        for (let page = 0; page < 2; page += 1) {
          await Promise.resolve();
          yield {
            workflowId: `workflow-${String(page)}`,
            closeTime: now,
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: defineSearchAttributeKey(
                  "TemporalScheduledById",
                  "KEYWORD",
                ),
                value: `schedule-${String(page)}`,
              },
              {
                key: defineSearchAttributeKey(
                  "TemporalScheduledStartTime",
                  "DATETIME",
                ),
                value: now,
              },
            ]),
          };
        }
      })(),
    );
    expect(await listCompletedScheduleActions(list, now)).toHaveLength(2);
    await expect(
      listCompletedScheduleActions(
        () =>
          (async function* () {
            yield {
              workflowId: "malformed",
              typedSearchAttributes: new TypedSearchAttributes(),
            };
          })(),
        now,
      ),
    ).rejects.toThrow("missing schedule identity or scheduled time");
  });
});
