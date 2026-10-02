import { describe, expect, test } from "vitest";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { mapTemporalSchedules, scheduleOutcome } from "./temporal-schedules.ts";
import type {
  ScheduleHealthObservation,
  ScheduleExecutionObservation,
} from "./temporal-schedules-client.ts";
import { collectTemporalSchedules } from "./temporal-schedules-collector.ts";
import { register } from "#observability/metrics.ts";

const now = new Date("2026-10-01T12:00:00Z");
const context = { now, services: new ServiceIndex() };
const scheduleMetricLines = (text: string) =>
  text.split("\n").filter((line) => line.startsWith("temporal_schedule_"));
function action(
  hoursAgo: number,
  status: ScheduleExecutionObservation["status"],
): ScheduleExecutionObservation {
  return {
    scheduledAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    workflowId: `run-${String(hoursAgo)}`,
    firstExecutionRunId: `id-${String(hoursAgo)}`,
    status,
  };
}
function observation(
  actions: ScheduleExecutionObservation[],
  overrides: Partial<ScheduleHealthObservation> = {},
): ScheduleHealthObservation {
  return {
    namespace: "prod",
    scheduleId: "nightly",
    workflowType: "runBackup",
    taskQueue: "infra",
    paused: false,
    observedAt: now.toISOString(),
    running: actions.some((entry) => entry.status === "RUNNING"),
    actions,
    ...overrides,
  };
}

describe("Temporal current schedule health", () => {
  test("orders by scheduled occurrence rather than list position or close time", () => {
    const result = scheduleOutcome(
      observation([
        action(1, "FAILED"),
        { ...action(3, "COMPLETED"), closedAt: now.toISOString() },
      ]),
      now,
    );
    expect(result.failed).toBe(true);
    expect(result.terminal?.workflowId).toBe("run-1");
  });
  test("a running successor retains failure until a later occurrence completes", () => {
    expect(
      scheduleOutcome(
        observation([action(2, "FAILED"), action(1, "RUNNING")]),
        now,
      ),
    ).toMatchObject({ failed: true, unknown: false });
    expect(
      scheduleOutcome(
        observation([action(2, "FAILED"), action(1, "COMPLETED")]),
        now,
      ),
    ).toMatchObject({ failed: false, unknown: false });
  });
  test("expired or missing execution evidence is unknown and never a recovery", () => {
    expect(
      scheduleOutcome(
        observation([action(2, "FAILED"), action(1, "MISSING")]),
        now,
      ),
    ).toMatchObject({ failed: true, unknown: true });
    expect(
      scheduleOutcome(
        observation([action(2, "COMPLETED")], {
          observedAt: action(1, "RUNNING").scheduledAt,
        }),
        now,
      ).unknown,
    ).toBe(true);
    expect(scheduleOutcome(observation([]), now).unknown).toBe(true);
  });
  test("paused inventory preserves note and failures without inventing a new action", () => {
    const mapped = mapTemporalSchedules(
      [
        observation([action(2, "FAILED")], {
          paused: true,
          pauseNote: "capacity remediation",
        }),
      ],
      context,
    );
    expect(mapped.signals.map((signal) => signal.kind)).toEqual([
      "schedule-paused",
      "schedule-failure",
    ]);
    expect(mapped.signals[0]?.detail).toBe("capacity remediation");
  });
  test("empty inventory and duplicate identities do not report all clear", () => {
    expect(mapTemporalSchedules([], context).metrics[0]?.severity).toBe(
      "unknown",
    );
    expect(() =>
      mapTemporalSchedules([observation([]), observation([])], context),
    ).toThrow(/Duplicate/);
  });
  test("failed collection preserves its last observation timestamp", async () => {
    await collectTemporalSchedules("prod", context, () =>
      Promise.resolve([observation([action(2, "FAILED")])]),
    );
    const before = await register.metrics();
    await expect(
      collectTemporalSchedules(
        "prod",
        { ...context, now: new Date(now.getTime() + 3_600_000) },
        () => Promise.reject(new Error("unavailable")),
      ),
    ).rejects.toThrow("unavailable");
    const after = await register.metrics();
    expect(scheduleMetricLines(after)).toEqual(scheduleMetricLines(before));
    expect(after).not.toContain("run-2");
  });
  test("a complete production inventory retains both production and beta gauges", async () => {
    await collectTemporalSchedules("prod", context, () =>
      Promise.resolve([
        observation([action(2, "FAILED")]),
        observation([action(1, "COMPLETED")], { namespace: "beta" }),
      ]),
    );
    const metrics = await register.metrics();
    expect(metrics).toContain(
      'temporal_schedule_last_terminal_failed{temporal_namespace="prod",schedule_id="nightly",workflow_type="runBackup",component="temporal-worker"} 1',
    );
    expect(metrics).toContain(
      'temporal_schedule_last_terminal_failed{temporal_namespace="beta",schedule_id="nightly",workflow_type="runBackup",component="temporal-worker"} 0',
    );
  });
});
