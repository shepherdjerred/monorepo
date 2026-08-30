import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { SCHEDULES } from "./schedule-definitions.ts";

test("no active start surface targets the retired default queue", async () => {
  expect(
    SCHEDULES.every((schedule) =>
      Object.values(TASK_QUEUES).includes(schedule.taskQueue),
    ),
  ).toBe(true);
  const packageRoot = new URL("../../", import.meta.url).pathname;
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

test("does not retain retired worker roles or the activity union", async () => {
  const packageRoot = new URL("../../", import.meta.url).pathname;
  for await (const relativePath of new Bun.Glob("src/**/*.ts").scan({
    cwd: packageRoot,
  })) {
    if (relativePath.endsWith(".test.ts")) continue;
    const source = await Bun.file(`${packageRoot}/${relativePath}`).text();
    expect(source, relativePath).not.toMatch(
      /TEMPORAL_WORKER_ROLE.*(?:core|legacy)/u,
    );
    expect(source, relativePath).not.toMatch(
      /role:\s*["'](?:core|legacy)["']/u,
    );
    expect(source, relativePath).not.toContain("export const activities");
  }
});
