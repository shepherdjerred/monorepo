import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { SCHEDULES } from "./schedule-definitions.ts";

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
    expect(source, relativePath).not.toContain("TASK_QUEUES.DEFAULT");
    expect(source, relativePath).not.toMatch(/taskQueue:\s*["']default["']/u);
  }
});
