import { describe, expect, test } from "bun:test";
import { resolveModelConfig } from "tasknotes-types/v2";
import type { TaskInfo } from "tasknotes-types/v2";

import {
  computeActiveSessions,
  computeTimeSummary,
} from "../engine/time-reports.ts";

const config = resolveModelConfig();
const NOW = new Date("2026-07-03T12:00:00.000Z");

function task(overrides: Partial<TaskInfo> & { path: string }): TaskInfo {
  return {
    title: overrides.path,
    status: "open",
    priority: "normal",
    archived: false,
    ...overrides,
  };
}

const TASKS: TaskInfo[] = [
  task({
    path: "a.md",
    title: "Deep work",
    projects: ["Focus"],
    tags: ["work"],
    timeEntries: [
      // closed 90-minute session today
      {
        startTime: "2026-07-03T08:00:00.000Z",
        endTime: "2026-07-03T09:30:00.000Z",
      },
    ],
  }),
  task({
    path: "b.md",
    title: "Ongoing",
    timeEntries: [
      // open session started 45 minutes before NOW
      { startTime: "2026-07-03T11:15:00.000Z", description: "in flight" },
    ],
  }),
  task({
    path: "c.md",
    title: "Old work",
    status: "done",
    timeEntries: [
      // outside the "today" window
      {
        startTime: "2026-06-01T08:00:00.000Z",
        endTime: "2026-06-01T09:00:00.000Z",
      },
    ],
  }),
];

describe("computeTimeSummary", () => {
  test("period=all counts everything; open sessions accrue against now", () => {
    const result = computeTimeSummary(TASKS, { period: "all" }, config, NOW);
    expect(result.summary.totalMinutes).toBe(90 + 45 + 60);
    expect(result.summary.tasksWithTime).toBe(3);
    expect(result.summary.activeTasks).toBe(1); // b (open session)
    expect(result.summary.completedTasks).toBe(1); // c (done)
    expect(result.topTasks[0]?.task).toBe("a.md"); // 90 min tops the list
    expect(result.topProjects).toEqual([{ project: "Focus", minutes: 90 }]);
    expect(result.topTags).toEqual([{ tag: "work", minutes: 90 }]);
  });

  test("explicit from/to range excludes sessions outside it", () => {
    const result = computeTimeSummary(
      TASKS,
      {
        period: "custom",
        fromDate: new Date("2026-07-03T00:00:00.000Z"),
        toDate: new Date("2026-07-03T23:59:59.000Z"),
      },
      config,
      NOW,
    );
    expect(result.summary.totalMinutes).toBe(90 + 45);
    expect(result.summary.tasksWithTime).toBe(2);
  });
});

describe("computeActiveSessions", () => {
  test("lists only open sessions with live elapsed minutes", () => {
    const result = computeActiveSessions(TASKS, NOW);
    expect(result.totalActiveSessions).toBe(1);
    expect(result.totalElapsedMinutes).toBe(45);
    expect(result.activeSessions[0]?.task.id).toBe("b.md");
    expect(result.activeSessions[0]?.session.description).toBe("in flight");
  });
});
