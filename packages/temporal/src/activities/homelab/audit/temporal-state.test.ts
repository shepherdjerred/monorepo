import { describe, expect, test } from "vitest";
import { msToTs } from "@temporalio/common/lib/time.js";
import { temporalFindings } from "#activities/homelab/homelab-audit-collectors.ts";
import {
  temporalFailureRecovery,
  temporalStallReasons,
  type AuditTemporalExecution,
} from "./temporal-state.ts";
import type { ScheduleHealthObservation } from "#activities/ops/temporal-schedules-client.ts";

const now = new Date("2026-10-09T12:00:00Z");
const old = msToTs(now.getTime() - 7 * 3600 * 1000);
const recent = msToTs(now.getTime() - 60 * 1000);
const running = { name: "RUNNING" as const };
const completed = { name: "COMPLETED" as const };
const failed: AuditTemporalExecution = {
  namespace: "prod",
  workflowId: "scheduled-action-1",
  runId: "failed-run",
  firstRunId: "first-run",
  workflowType: "report",
  startedAt: "2026-10-09T01:00:00Z",
};
const latest: Parameters<typeof temporalFailureRecovery>[1] = {
  status: completed,
  runId: "new-run",
  raw: { workflowExecutionInfo: { firstRunId: "first-run" } },
};
const schedule: ScheduleHealthObservation = {
  namespace: "prod",
  scheduleId: "audit",
  workflowType: "report",
  taskQueue: "reports",
  paused: false,
  observedAt: now.toISOString(),
  running: false,
  actions: [
    {
      scheduledAt: failed.startedAt,
      workflowId: failed.workflowId,
      firstExecutionRunId: "first-run",
      status: "FAILED",
    },
    {
      scheduledAt: "2026-10-09T02:00:00Z",
      workflowId: "scheduled-action-2",
      firstExecutionRunId: "second-run",
      status: "COMPLETED",
    },
  ],
};

describe("Temporal audit progress evidence", () => {
  test("quiet durable workflows and recent heartbeats do not become stalls by age", () => {
    expect(temporalStallReasons({ status: running, raw: {} }, now)).toEqual([]);
    expect(
      temporalStallReasons(
        {
          status: running,
          raw: {
            pendingActivities: [
              {
                activityId: "rebuild",
                scheduledTime: old,
                lastStartedTime: old,
                lastHeartbeatTime: recent,
              },
            ],
          },
        },
        now,
      ),
    ).toEqual([]);
  });
  test("detects an old workflow task retry and a heartbeat that stopped", () => {
    const reasons = temporalStallReasons(
      {
        status: running,
        raw: {
          pendingWorkflowTask: {
            originalScheduledTime: old,
            scheduledTime: recent,
            attempt: 745,
          },
          pendingActivities: [{ activityId: "lake", lastHeartbeatTime: old }],
        },
      },
      now,
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("attempt 745");
    expect(reasons[1]).toContain("Activity lake");
  });
  test("completed executions observed during the scan are not stalled", () => {
    expect(
      temporalStallReasons(
        {
          status: completed,
          raw: { pendingWorkflowTask: { scheduledTime: old } },
        },
        now,
      ),
    ).toEqual([]);
  });
});

describe("Temporal audit recovery evidence", () => {
  test("fresh routing timestamps do not hide repeated workflow-task failures", () => {
    expect(
      temporalStallReasons(
        {
          status: running,
          raw: {
            pendingWorkflowTask: {
              originalScheduledTime: recent,
              scheduledTime: recent,
              attempt: 748,
            },
          },
        },
        now,
      ),
    ).toEqual(["Workflow task has repeatedly failed (attempt 748)"]);
  });
  test("requires the same run chain for retry recovery", () => {
    expect(temporalFailureRecovery(failed, latest, [], now)).toContain(
      "completed retry",
    );
    expect(
      temporalFailureRecovery(
        failed,
        {
          ...latest,
          raw: { workflowExecutionInfo: { firstRunId: "unrelated" } },
        },
        [],
        now,
      ),
    ).toBeUndefined();
  });
  test("a later completed schedule action resolves historical failures", () => {
    expect(
      temporalFailureRecovery(
        failed,
        { ...latest, status: running },
        [schedule],
        now,
      ),
    ).toContain("completed a later action");
  });
  test("running or unknown successors do not fabricate recovery", () => {
    const [first] = schedule.actions;
    if (first === undefined) throw new Error("Missing fixture action");
    for (const status of ["RUNNING", "MISSING"] as const) {
      expect(
        temporalFailureRecovery(
          failed,
          { ...latest, status: running },
          [
            {
              ...schedule,
              actions: [
                first,
                {
                  scheduledAt: "2026-10-09T02:00:00Z",
                  workflowId: "next",
                  firstExecutionRunId: "next-run",
                  status,
                },
              ],
            },
          ],
          now,
        ),
      ).toBeUndefined();
    }
  });
  test("keeps recovered failures in the report as informational evidence", () => {
    const findings = temporalFindings(
      [
        {
          namespace: "prod",
          scheduleCount: 1,
          failed: [{ ...failed, recoveredBy: "later completed action" }],
          stalled: [
            {
              ...failed,
              workflowId: "idle-chat",
              workflowType: "agentChatWorkflow",
              stallReasons: [],
            },
          ],
        },
      ],
      "temporal-evidence",
    );
    expect(
      findings.map((finding) => [finding.state, finding.severity]),
    ).toEqual([
      ["recovered", "info"],
      ["observing", "info"],
    ]);
  });
});
