import { describe, expect, test } from "bun:test";
import { resolveModelConfig } from "tasknotes-types/v2";
import type { TaskInfo } from "tasknotes-types/v2";

import { computeFilterOptions, computeStats } from "../engine/stats.ts";

const config = resolveModelConfig();

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
  task({ path: "TaskNotes/a.md", due: "2026-07-01", contexts: ["home"] }),
  task({ path: "TaskNotes/b.md", status: "done", tags: ["task", "x"] }),
  task({ path: "TaskNotes/c.md", archived: true, projects: ["Finance"] }),
  task({
    path: "d.md",
    due: "2026-07-09",
    timeEntries: [{ startTime: "2026-07-01T09:00:00Z", duration: 5 }],
  }),
];

describe("computeStats", () => {
  test("counts against the configured workflow and today", () => {
    const stats = computeStats(TASKS, config, "2026-07-03");
    expect(stats).toEqual({
      total: 4,
      completed: 1,
      active: 2, // a (open) + d (open); c is archived
      overdue: 1, // a: due 07-01 < 07-03
      archived: 1,
      withTimeTracking: 1,
    });
  });
});

describe("computeFilterOptions", () => {
  test("returns config OBJECTS for statuses/priorities plus vault values", () => {
    const options = computeFilterOptions(TASKS, config);
    expect(options.statuses[0]?.value).toBeDefined(); // objects, not strings
    expect(options.priorities.length).toBeGreaterThan(0);
    expect(options.contexts).toEqual(["home"]);
    expect(options.projects).toEqual(["Finance"]);
    expect(options.tags).toEqual(["task", "x"]);
    expect(options.folders).toEqual(["", "TaskNotes"]);
  });
});
