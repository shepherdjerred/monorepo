import { afterEach, expect, test, vi } from "vitest";
import type { CronJob } from "cron";
import { createCronJob } from "./helpers.ts";

let job: CronJob | undefined;

afterEach(() => {
  job?.stop();
  job = undefined;
});

test("checks execution ownership on every tick", async () => {
  let legacyOwnsExecution = false;
  const task = vi.fn(async () => {});
  job = createCronJob({
    schedule: "0 0 1 1 *",
    jobName: "ownership-test",
    task,
    logMessage: "ownership test",
    runOnInit: false,
    isExecutionOwner: () => legacyOwnsExecution,
  });

  await job.fireOnTick();
  expect(task).not.toHaveBeenCalled();

  legacyOwnsExecution = true;
  await job.fireOnTick();
  expect(task).toHaveBeenCalledOnce();
});
