import { expect, test } from "vitest";
import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { MEDIA_SCHEDULES } from "#schedules/media.ts";
import { QUEUE_WORKER_DEFINITIONS } from "#worker-config";
test("capacity schedule is paused and each Activity has only its intended capability role", () => {
  expect(
    MEDIA_SCHEDULES.find((item) => item.id === "media-capacity"),
  ).toMatchObject({
    namespace: "prod",
    workflowType: "observeMediaCapacityWorkflow",
    timing: { kind: "interval", every: "1 minute" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    initialPauseNote: expect.any(String),
  });
  for (const [name, role] of [
    ["observeMediaCapacityMounts", "media-network"],
    ["sampleMediaCapacity", "media-files"],
  ] as const) {
    const owners = QUEUE_WORKER_DEFINITIONS.filter(
      (item) => item.kind === "activity" && name in item.activities,
    ).map((item) => item.role);
    expect(owners).toEqual([role]);
  }
});
