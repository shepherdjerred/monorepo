import { z } from "zod";

const TaskSummarySchema = z.object({
  taskId: z.string(),
  task: z.string(),
  package: z.string(),
  execution: z
    .object({
      exitCode: z.number().nullable().optional(),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
    })
    .optional(),
  cache: z.object({ status: z.string() }).optional(),
});

export const TurboRunSummarySchema = z.object({
  execution: z.object({
    attempted: z.number(),
    cached: z.number(),
    failed: z.number(),
    success: z.number(),
    startTime: z.number(),
    endTime: z.number(),
  }),
  tasks: z.array(TaskSummarySchema),
});

export type TurboRunSummary = z.infer<typeof TurboRunSummarySchema>;
export type CiTaskState = "passed" | "failed" | "cached" | "not-run";
export type CiTaskCategory = "test" | "lint" | "build" | "generate" | "quality";

export type CiTask = {
  id: string;
  package: string;
  task: string;
  category: CiTaskCategory;
  state: CiTaskState;
  cache: string;
  durationSeconds?: number;
  jobUrl?: string;
};

export type CiTaskReport = {
  version: 1;
  run: {
    attempted: number;
    cached: number;
    failed: number;
    passed: number;
    durationSeconds: number;
    jobUrl?: string;
  };
  links: {
    testEngine: string;
    artifacts?: string;
  };
  categories: Record<CiTaskCategory, Record<CiTaskState, number>>;
  tasks: CiTask[];
};

export function taskCategory(task: string): CiTaskCategory {
  if (task.startsWith("test")) return "test";
  if (task.startsWith("lint")) return "lint";
  if (task === "build" || task.startsWith("docker")) return "build";
  if (task.startsWith("generate")) return "generate";
  return "quality";
}

function taskState(task: z.infer<typeof TaskSummarySchema>): CiTaskState {
  const exitCode = task.execution?.exitCode;
  if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
    return "failed";
  }
  if (task.cache?.status === "HIT") {
    return "cached";
  }
  if (exitCode === 0) {
    return "passed";
  }
  return "not-run";
}

function taskDuration(
  task: z.infer<typeof TaskSummarySchema>,
): number | undefined {
  const start = task.execution?.startTime;
  const end = task.execution?.endTime;
  return start === undefined || end === undefined
    ? undefined
    : (end - start) / 1000;
}

function emptyCategoryCounts(): Record<CiTaskState, number> {
  return { passed: 0, failed: 0, cached: 0, "not-run": 0 };
}

export function buildCiTaskReport(
  summary: TurboRunSummary,
  buildUrl?: string,
  jobId?: string,
): CiTaskReport {
  const jobUrl =
    buildUrl === undefined || jobId === undefined
      ? undefined
      : `${buildUrl}#${jobId}`;
  const artifacts =
    buildUrl === undefined ? undefined : `${buildUrl}#artifacts`;
  const categories: Record<CiTaskCategory, Record<CiTaskState, number>> = {
    test: emptyCategoryCounts(),
    lint: emptyCategoryCounts(),
    build: emptyCategoryCounts(),
    generate: emptyCategoryCounts(),
    quality: emptyCategoryCounts(),
  };
  const tasks = summary.tasks
    .map((task): CiTask => {
      const category = taskCategory(task.task);
      const state = taskState(task);
      categories[category][state] += 1;
      const durationSeconds = taskDuration(task);
      return {
        id: task.taskId,
        package: task.package,
        task: task.task,
        category,
        state,
        cache: task.cache?.status ?? "UNKNOWN",
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
        ...(jobUrl === undefined ? {} : { jobUrl }),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    version: 1,
    run: {
      attempted: summary.execution.attempted,
      cached: summary.execution.cached,
      failed: summary.execution.failed,
      passed: summary.execution.success,
      durationSeconds:
        (summary.execution.endTime - summary.execution.startTime) / 1000,
      ...(jobUrl === undefined ? {} : { jobUrl }),
    },
    links: {
      testEngine:
        "https://buildkite.com/organizations/sjerred/analytics/suites/monorepo-tests",
      ...(artifacts === undefined ? {} : { artifacts }),
    },
    categories,
    tasks,
  };
}

function formatDuration(durationSeconds: number | undefined): string {
  return durationSeconds === undefined ? "—" : `${durationSeconds.toFixed(1)}s`;
}

export function renderCiTaskReport(
  report: CiTaskReport,
  includeAllTasks: boolean,
): string {
  const lines = [
    `### :turborepo: CI task summary — ${report.run.attempted.toString()} tasks in ${report.run.durationSeconds.toFixed(1)}s`,
    "",
    "| Category | Passed | Cached | Failed | Not run |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...(["test", "lint", "build", "generate", "quality"] as const).map(
      (category) => {
        const counts = report.categories[category];
        return `| ${category} | ${counts.passed.toString()} | ${counts.cached.toString()} | ${counts.failed.toString()} | ${counts["not-run"].toString()} |`;
      },
    ),
    "",
    [
      `[Test Engine](${report.links.testEngine})`,
      report.links.artifacts === undefined
        ? undefined
        : `[JUnit and coverage artifacts](${report.links.artifacts})`,
      report.run.jobUrl === undefined
        ? undefined
        : `[Job log](${report.run.jobUrl})`,
    ]
      .filter((link) => link !== undefined)
      .join(" · "),
  ];
  const displayedTasks = includeAllTasks
    ? report.tasks
    : report.tasks.filter((task) => task.state === "failed");
  if (displayedTasks.length > 0) {
    lines.push(
      "",
      includeAllTasks ? "**Tasks**" : "**Failed tasks**",
      "",
      "| Task | Category | State | Cache | Duration |",
      "| --- | --- | --- | --- | ---: |",
      ...displayedTasks.map(
        (task) =>
          `| \`${task.id}\` | ${task.category} | ${task.state} | ${task.cache} | ${formatDuration(task.durationSeconds)} |`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
