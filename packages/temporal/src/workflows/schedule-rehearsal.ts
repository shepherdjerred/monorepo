import { proxyActivities } from "@temporalio/workflow";
import type {
  ScheduleRehearsalActivities,
  ScheduleRehearsalResult,
} from "#activities/schedule-rehearsal.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

// The rehearsal runs on the SCOUT queue, not maintenance: the jobs it
// rehearses (scout-data-dragon-weekly-refresh, the season refresh, the lane
// priors refresh) all execute there, so this exercises the same worker image,
// the same pod limits, and the same network path they will meet. A rehearsal
// on a different worker would prove less than the thing it is standing in for.
//
// One attempt, no retry: a failed rehearsal is a finding, and the point is to
// surface it before Saturday. Retrying would spend 3x the install cost to turn
// a real regression into a slower real regression, and a genuinely transient
// registry blip is already retried inside bot-clone's withInstallRetry.
const { rehearseScheduleBotClone } =
  proxyActivities<ScheduleRehearsalActivities>({
    taskQueue: TASK_QUEUES.SCOUT,
    startToCloseTimeout: "45 minutes",
    heartbeatTimeout: "90 seconds",
    retry: { maximumAttempts: 1 },
  });

/**
 * Weekly dress rehearsal of the bot-clone pipeline behind every PR-creating
 * scheduled workflow, run the day before the weekly job it protects.
 *
 * Failure handling is deliberately plain: no report, no alert publication. The
 * workflow simply fails, and `pollWorkflowFailuresWorkflow` turns that into an
 * occurrence like any other workflow failure. Adding a bespoke delivery path
 * here would duplicate machinery that already covers it.
 */
export async function runScheduleRehearsalWorkflow(): Promise<ScheduleRehearsalResult> {
  return rehearseScheduleBotClone();
}
