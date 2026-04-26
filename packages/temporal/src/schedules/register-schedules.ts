import type { Client } from "@temporalio/client";
import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";

// All cron expressions below are wall-clock local time for the homelab.
const SCHEDULE_TIMEZONE = "America/Los_Angeles";

type ScheduleDefinition = {
  id: string;
  workflowType: string;
  args: unknown[];
  cronExpression: string;
  taskQueue: string;
  overlap: ScheduleOverlapPolicy;
  memo: string;
  workflowExecutionTimeout?: Duration;
};

const SCHEDULES: ScheduleDefinition[] = [
  {
    id: "fetcher-skill-capped",
    workflowType: "fetchSkillCappedManifest",
    args: [],
    cronExpression: "*/15 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Fetch Better Skill Capped manifest from Firestore and upload to S3",
  },
  {
    id: "deps-summary-weekly",
    workflowType: "generateDependencySummary",
    args: [7],
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Weekly dependency summary email",
  },
  {
    id: "dns-audit-daily",
    workflowType: "runDnsAudit",
    args: [],
    cronExpression: "0 6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Daily DNS record audit (SPF, DMARC, MX)",
  },
  {
    id: "scout-data-dragon-version-check",
    workflowType: "runScoutDataDragonVersionCheck",
    args: [],
    cronExpression: "0 6 * * 0-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "3 hours",
    memo: "Check LoL Data Dragon version and update Scout assets when needed",
  },
  {
    id: "scout-data-dragon-weekly-refresh",
    workflowType: "runScoutDataDragonWeeklyRefresh",
    args: [],
    cronExpression: "0 6 * * 6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "3 hours",
    memo: "Weekly Scout Data Dragon refresh even when version is unchanged",
  },
  {
    id: "zfs-maintenance-weekly",
    workflowType: "runZfsMaintenanceWorkflow",
    args: [],
    cronExpression: "0 3 * * 0",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "15 minutes",
    memo: "Weekly ZFS pool scrub + autotrim (zfspv-pool-nvme, zfspv-pool-hdd)",
  },
  {
    id: "bugsink-housekeeping",
    workflowType: "runBugsinkHousekeepingWorkflow",
    args: [],
    cronExpression: "0 3 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Daily Bugsink database housekeeping (delete old events, vacuum)",
  },
  {
    id: "docs-groom-daily",
    workflowType: "runDocsGroomAudit",
    args: [],
    cronExpression: "30 6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Daily packages/docs grooming via claude -p; opens draft PRs for easy/medium tasks",
  },
  {
    id: "golink-sync",
    workflowType: "syncGolinks",
    args: [],
    cronExpression: "*/5 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "4 minutes",
    memo: "Sync Tailscale ingresses to golink aliases",
  },
  {
    id: "vacuum-9am",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 9 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Run vacuum if no one is home (9 AM)",
  },
  {
    id: "vacuum-12pm",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 12 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Run vacuum if no one is home (12 PM)",
  },
  {
    id: "vacuum-5pm",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 17 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Run vacuum if no one is home (5 PM)",
  },
  {
    id: "good-morning-weekday-early",
    workflowType: "goodMorningEarly",
    args: [],
    cronExpression: "0 7 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning pre-wake (weekdays 7 AM)",
  },
  {
    id: "good-morning-weekday-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 8 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning wake-up (weekdays 8 AM)",
  },
  {
    id: "good-morning-weekday-up",
    workflowType: "goodMorningGetUp",
    args: [],
    cronExpression: "15 8 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning get-up (weekdays 8:15 AM)",
  },
  {
    id: "good-morning-weekend-early",
    workflowType: "goodMorningEarly",
    args: [],
    cronExpression: "0 8 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning pre-wake (weekends 8 AM)",
  },
  {
    id: "good-morning-weekend-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 9 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning wake-up (weekends 9 AM)",
  },
  {
    id: "good-morning-weekend-up",
    workflowType: "goodMorningGetUp",
    args: [],
    cronExpression: "15 9 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    memo: "Good morning get-up (weekends 9:15 AM)",
  },
];

export async function registerSchedules(client: Client): Promise<void> {
  const scheduleClient = client.schedule;

  for (const schedule of SCHEDULES) {
    try {
      // Try to get existing schedule handle
      const handle = scheduleClient.getHandle(schedule.id);

      // Update the existing schedule
      await handle.update((prev) => ({
        ...prev,
        spec: {
          cronExpressions: [schedule.cronExpression],
          timezone: SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
          ...(schedule.workflowExecutionTimeout === undefined
            ? {}
            : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
        },
        policies: {
          overlap: schedule.overlap,
        },
      }));

      console.warn(`Updated schedule: ${schedule.id}`);
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
      // Schedule doesn't exist yet — create it
      await scheduleClient.create({
        scheduleId: schedule.id,
        spec: {
          cronExpressions: [schedule.cronExpression],
          timezone: SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
          ...(schedule.workflowExecutionTimeout === undefined
            ? {}
            : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
        },
        policies: {
          overlap: schedule.overlap,
        },
        memo: { description: schedule.memo },
      });

      console.warn(`Created schedule: ${schedule.id}`);
    }
  }
}
