import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { SCHEDULES } from "./schedule-definitions.ts";

const DEFAULT_QUEUE_COMPATIBILITY_PATHS = new Map([
  ["src/workflows/agent-task.ts", "agent-task-reports-email-delivery-v1"],
  ["src/workflows/link-rot-scan.ts", "link-rot-scan-reports-queue-v1"],
  ["src/workflows/main-vuln-scan.ts", "main-vuln-scan-reports-queue-v1"],
  ["src/workflows/report-activity-queue.ts", "REPORT_ACTIVITY_QUEUE_PATCH"],
  ["src/workflows/report-delivery.ts", "report-delivery-reports-queue-v1"],
]);

test("no active start surface targets the migration-only default queue", async () => {
  expect(
    SCHEDULES.every((schedule) => schedule.taskQueue !== TASK_QUEUES.DEFAULT),
  ).toBe(true);

  const packageRoot = import.meta.dir.replace(/\/src\/schedules$/u, "");
  const glob = new Bun.Glob("{src/event-bridge,src/workflows,scripts}/**/*.ts");
  for await (const relativePath of glob.scan({ cwd: packageRoot })) {
    if (relativePath.endsWith(".test.ts")) {
      continue;
    }
    const source = await Bun.file(`${packageRoot}/${relativePath}`).text();
    const usesDefaultQueue =
      source.includes("TASK_QUEUES.DEFAULT") ||
      /taskQueue:\s*["']default["']/u.test(source);
    if (!usesDefaultQueue) {
      continue;
    }
    const compatibilityPatch =
      DEFAULT_QUEUE_COMPATIBILITY_PATHS.get(relativePath);
    if (compatibilityPatch === undefined) {
      throw new Error(
        `undocumented default queue reference in ${relativePath}`,
      );
    }
    expect(source, relativePath).toContain(compatibilityPatch);
    expect(source, relativePath).toMatch(/legacy|pre-migration|replay/u);
  }
});
