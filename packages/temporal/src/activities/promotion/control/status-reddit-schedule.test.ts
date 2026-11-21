import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ScheduleNotFoundError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { readRedditOutreachSchedule } from "./status-reddit-schedule.ts";

const temporal = vi.hoisted(() => ({
  client: vi.fn(),
  schedule: vi.fn(),
  describeSchedule: vi.fn(),
  list: vi.fn(),
  describeRun: vi.fn(),
  workflow: vi.fn(),
}));
vi.mock("#client", () => ({ createTemporalReadClient: temporal.client }));

const scheduleId = "the-storm-reddit-outreach";
const startTime = new Date("2026-11-01T07:15:00.000Z");
const closeTime = new Date("2026-11-01T07:16:16.000Z");
const nextRun = new Date("2026-11-01T07:30:00.000Z");

function action(workflowId: string) {
  return {
    takenAt: startTime,
    action: { workflow: { workflowId, firstExecutionRunId: "run" } },
  };
}

beforeEach(() => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  temporal.schedule.mockReturnValue({ describe: temporal.describeSchedule });
  temporal.workflow.mockImplementation((id: string) => ({
    describe: () => temporal.describeRun(id),
  }));
  temporal.describeSchedule.mockResolvedValue({
    state: { paused: false },
    info: {
      recentActions: [action("missing-audit"), action("audited")],
      nextActionTimes: [nextRun],
    },
  });
  temporal.list.mockImplementation(async function* () {
    await Promise.resolve();
    yield { workflowId: "older-run", runId: "run", startTime };
  });
  temporal.client.mockResolvedValue({
    connection: {
      withDeadline: (_deadline: number, read: () => Promise<unknown>) => read(),
      withAbortSignal: (_signal: AbortSignal, read: () => Promise<unknown>) =>
        read(),
    },
    schedule: { getHandle: temporal.schedule },
    workflow: { list: temporal.list, getHandle: temporal.workflow },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("reads the production schedule and describes only workflows without audited outcomes", async () => {
  temporal.describeRun.mockImplementation((id: string) =>
    id === "older-run"
      ? Promise.resolve({
          runId: "run",
          startTime,
          status: { name: "RUNNING" },
        })
      : Promise.resolve({
          runId: "run",
          startTime,
          closeTime,
          status: { name: "FAILED" },
        }),
  );
  const observed = await readRedditOutreachSchedule(
    "2026-10-31",
    new Set(["audited/run"]),
    new Set(["missing-audit/run", "earlier/manual/run"]),
  );
  expect(temporal.client).toHaveBeenCalledWith("prod", {
    connectTimeout: 4000,
  });
  expect(temporal.schedule).toHaveBeenCalledWith(scheduleId);
  expect(temporal.list).toHaveBeenCalledWith({
    query: `TemporalScheduledById = "${scheduleId}" AND StartTime >= "2026-10-31T00:00:00Z"`,
    pageSize: 12,
  });
  expect(temporal.workflow.mock.calls).toEqual([
    ["missing-audit", "run"],
    ["older-run", "run"],
    ["earlier/manual", "run"],
  ]);
  expect(observed).toEqual({
    schedule: {
      state: "active",
      lastRunAt: startTime.toISOString(),
      nextRunAt: nextRun.toISOString(),
    },
    executions: [
      {
        id: "missing-audit/run",
        status: "failed",
        at: closeTime.toISOString(),
        completedAt: closeTime.toISOString(),
        elapsedMs: 76_000,
      },
      {
        id: "older-run/run",
        status: "running",
        at: startTime.toISOString(),
        completedAt: null,
        elapsedMs: null,
      },
      {
        id: "earlier/manual/run",
        status: "failed",
        at: closeTime.toISOString(),
        completedAt: closeTime.toISOString(),
        elapsedMs: 76_000,
      },
    ],
  });
});

it("keeps paused state and recent actions when visibility is unavailable, and distinguishes a missing schedule", async () => {
  temporal.describeSchedule.mockResolvedValueOnce({
    state: { paused: true },
    info: {
      recentActions: [action("missing-run")],
      nextActionTimes: [nextRun],
    },
  });
  temporal.list.mockImplementationOnce(() => {
    throw new Error("private visibility error");
  });
  temporal.describeRun.mockRejectedValueOnce(
    new WorkflowNotFoundError("private workflow error", "missing-run", "run"),
  );
  const paused = await readRedditOutreachSchedule(
    "2026-10-31",
    new Set(),
    new Set(),
  );
  expect(paused).toMatchObject({
    schedule: { state: "paused", nextRunAt: null },
    executions: [{ id: "missing-run/run", status: "missing" }],
  });
  temporal.describeSchedule.mockRejectedValueOnce(
    new ScheduleNotFoundError("private schedule error", scheduleId),
  );
  temporal.describeRun.mockResolvedValueOnce({
    runId: "run",
    startTime,
    closeTime,
    status: { name: "FAILED" },
  });
  const missing = await readRedditOutreachSchedule(
    "2026-10-31",
    new Set(),
    new Set(["earlier/run"]),
  );
  expect(missing).toMatchObject({
    schedule: { state: "missing", lastRunAt: null, nextRunAt: null },
    executions: [
      {
        id: "earlier/run",
        status: "failed",
        completedAt: closeTime.toISOString(),
      },
    ],
  });
});
