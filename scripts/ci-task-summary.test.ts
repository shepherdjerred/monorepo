import { describe, expect, test } from "bun:test";
import {
  buildCiTaskReport,
  renderCiTaskReport,
  taskCategory,
  TurboRunSummarySchema,
} from "./ci-task-summary.ts";

const summary = TurboRunSummarySchema.parse({
  execution: {
    attempted: 3,
    cached: 1,
    failed: 1,
    success: 1,
    startTime: 1000,
    endTime: 5000,
  },
  tasks: [
    {
      taskId: "pkg#test:ci",
      task: "test:ci",
      package: "pkg",
      cache: { status: "MISS" },
      execution: { exitCode: 0, startTime: 1000, endTime: 3000 },
    },
    {
      taskId: "pkg#lint",
      task: "lint",
      package: "pkg",
      cache: { status: "HIT" },
      execution: { exitCode: 0, startTime: 3000, endTime: 3000 },
    },
    {
      taskId: "pkg#build",
      task: "build",
      package: "pkg",
      cache: { status: "MISS" },
      execution: { exitCode: 2, startTime: 3000, endTime: 5000 },
    },
  ],
});

describe("CI task summary", () => {
  test("categorizes authoritative Turbo tasks", () => {
    expect(taskCategory("test:report")).toBe("test");
    expect(taskCategory("lint:helm")).toBe("lint");
    expect(taskCategory("build")).toBe("build");
    expect(taskCategory("generate")).toBe("generate");
    expect(taskCategory("check-todos")).toBe("quality");
  });

  test("records state, cache, duration, and Buildkite links", () => {
    const report = buildCiTaskReport(
      summary,
      "https://buildkite.com/sjerred/monorepo/builds/1",
      "job-id",
    );
    expect(report.categories.test.passed).toBe(1);
    expect(report.categories.lint.cached).toBe(1);
    expect(report.categories.build.failed).toBe(1);
    expect(report.tasks[0]?.jobUrl).toEndWith("#job-id");
    expect(report.tasks[0]?.durationSeconds).toBe(2);
    expect(report.links.artifacts).toBe(
      "https://buildkite.com/sjerred/monorepo/builds/1#artifacts",
    );
  });

  test("keeps annotations concise while artifacts contain every task", () => {
    const report = buildCiTaskReport(summary);
    const annotation = renderCiTaskReport(report, false);
    const artifact = renderCiTaskReport(report, true);
    expect(annotation).toContain("pkg#build");
    expect(annotation).not.toContain("pkg#test:ci");
    expect(artifact).toContain("pkg#test:ci");
  });

  test("does not treat an unexecuted task with a null exit code as failed", () => {
    const notRunSummary = TurboRunSummarySchema.parse({
      execution: {
        attempted: 0,
        cached: 0,
        failed: 0,
        success: 0,
        startTime: 1000,
        endTime: 1000,
      },
      tasks: [
        {
          taskId: "pkg#test:ci",
          task: "test:ci",
          package: "pkg",
          cache: { status: "MISS" },
          execution: { exitCode: null },
        },
      ],
    });

    const report = buildCiTaskReport(notRunSummary);
    expect(report.categories.test["not-run"]).toBe(1);
    expect(report.categories.test.failed).toBe(0);
  });
});
