import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";
import {
  classifyScheduleNamespace,
  isRootWorkflowExecution,
} from "./namespace-migration.ts";
import {
  cutoverTimestampForRetry,
  decodeMigrationState,
  encodeMigrationState,
  isSourceQuiescent,
  migrationAuditQueries,
  sourceStateAllowsCutover,
  targetPauseAction,
} from "./namespace-migration-state.ts";

describe("Temporal namespace migration ownership", () => {
  test("classifies every declared schedule by its source-owned namespace", () => {
    for (const schedule of SCHEDULES) {
      expect(classifyScheduleNamespace(schedule.id, undefined)).toBe(
        schedule.namespace,
      );
    }
  });

  test("routes stage-owned report schedules to their matching namespace", () => {
    const memo = {
      owner: "scout-for-lol",
      stage: "beta",
      reportId: "42",
      schemaVersion: 1,
    } as const;
    expect(classifyScheduleNamespace("scout-beta-report-42", memo)).toBe(
      "beta",
    );
    expect(() =>
      classifyScheduleNamespace("scout-prod-report-42", memo),
    ).toThrow("Unknown Scout schedule ownership");
  });

  test("routes dynamic agent schedules only to prod", () => {
    expect(classifyScheduleNamespace("agent-task-audit-123", undefined)).toBe(
      "prod",
    );
    expect(
      classifyScheduleNamespace("custom-agent-task", {
        dynamicAgentTask: true,
      }),
    ).toBe("prod");
  });

  test("blocks unknown schedule ownership", () => {
    expect(() =>
      classifyScheduleNamespace("unknown-live-schedule", undefined),
    ).toThrow("Unknown schedule ownership");
  });

  test.each([
    { sourcePaused: true, sourceNote: "operator pause" },
    { sourcePaused: false, sourceNote: undefined },
  ])("round-trips original pause state", (state) => {
    expect(decodeMigrationState(encodeMigrationState(state))).toEqual(state);
  });

  test("preserves a persisted cutover boundary across retries", () => {
    const firstBoundary = new Date("2026-08-30T03:00:00.000Z");
    expect(
      cutoverTimestampForRetry(
        [
          {
            migrationState: {
              sourcePaused: false,
              sourceNote: undefined,
              cutoverAt: firstBoundary.toISOString(),
            },
          },
        ],
        new Date("2026-08-30T03:05:00.000Z"),
        true,
      ),
    ).toEqual(firstBoundary);
  });

  test("uses an incomplete attempt boundary until cutover is complete", () => {
    const attemptedAt = new Date("2026-08-30T03:00:00.000Z");
    expect(
      cutoverTimestampForRetry(
        [
          {
            migrationState: {
              sourcePaused: false,
              sourceNote: undefined,
              attemptedAt: attemptedAt.toISOString(),
            },
          },
        ],
        new Date("2026-08-30T03:05:00.000Z"),
        true,
      ),
    ).toEqual(attemptedAt);
  });

  test("ignores an attempt boundary when no source was paused", () => {
    const retryAt = new Date("2026-08-30T03:05:00.000Z");
    expect(
      cutoverTimestampForRetry(
        [
          {
            migrationState: {
              sourcePaused: false,
              sourceNote: undefined,
              attemptedAt: "2026-08-30T03:00:00.000Z",
            },
          },
        ],
        retryAt,
        false,
      ),
    ).toEqual(retryAt);
  });

  test("audits open default executions and post-cutover starts separately", () => {
    expect(migrationAuditQueries(new Date("2026-08-30T03:00:00.000Z"))).toEqual(
      {
        open: 'ExecutionStatus = "Running"',
        startedAfterCutover: 'StartTime >= "2026-08-30T03:00:00.000Z"',
      },
    );
  });

  test("accepts a cutover retry after sources were migration-paused", () => {
    const prepared = { sourcePaused: false, sourceNote: undefined };
    expect(
      sourceStateAllowsCutover(
        {
          paused: true,
          note: "Migrated to environment-scoped Temporal namespace",
        },
        prepared,
      ),
    ).toBe(true);
    expect(
      sourceStateAllowsCutover(
        { paused: true, note: "unexpected operator pause" },
        prepared,
      ),
    ).toBe(false);
  });

  test("recognizes a source that was already operator-paused as quiescent", () => {
    expect(
      isSourceQuiescent(
        { paused: true, note: "operator pause" },
        { sourcePaused: true, sourceNote: "operator pause" },
      ),
    ).toBe(true);
    expect(
      isSourceQuiescent(
        { paused: true, note: "different pause" },
        { sourcePaused: true, sourceNote: "operator pause" },
      ),
    ).toBe(false);
  });

  test("target activation is idempotent during a partial cutover", () => {
    expect(
      targetPauseAction(false, {
        sourcePaused: false,
        sourceNote: undefined,
      }),
    ).toBeUndefined();
    expect(
      targetPauseAction(true, {
        sourcePaused: false,
        sourceNote: undefined,
      }),
    ).toBe("unpause");
    expect(
      targetPauseAction(true, {
        sourcePaused: true,
        sourceNote: "operator pause",
      }),
    ).toBeUndefined();
  });

  test("distinguishes drain continuations from new root executions", () => {
    expect(
      isRootWorkflowExecution({
        runId: "root-run",
        rootExecution: { runId: "root-run" },
      }),
    ).toBe(true);
    expect(
      isRootWorkflowExecution({
        runId: "continued-run",
        rootExecution: { runId: "root-run" },
      }),
    ).toBe(false);
  });
});
