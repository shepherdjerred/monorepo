import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

// 02:00 Pacific keeps the run clear of the working day and of the CI
// maintenance canaries it defers to. One submission, up to an hour of
// deferral and a 90-minute lane fit well inside the four-hour execution
// timeout; SKIP overlap means a slow night never stacks a second run.
// Registered paused: stable workers do not register this Workflow, so a run
// reaching one during the candidate window would wait out the execution
// timeout and alert falsely. Unpause once the candidate carrying it receives
// 100% of traffic (Tracker AI-485), together with the dispatch flag.
export const CI_EXTENDED_VERIFY_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "ci-extended-verify-nightly",
  workflowType: "runCiExtendedVerifyWorkflow",
  args: [],
  timing: {
    kind: "cron",
    expression: "0 2 * * *",
    timezone: "America/Los_Angeles",
  },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "4 hours",
  memo: "Nightly extended test tier on the newest verified main: one manual verify-extended Woodpecker pipeline that fails this Workflow when red; dispatch flag defaults off",
  initialPauseNote:
    "Awaiting 100% candidate traffic for runCiExtendedVerifyWorkflow; stable workers do not register this Workflow",
};
