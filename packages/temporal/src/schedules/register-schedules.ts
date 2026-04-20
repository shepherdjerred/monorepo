import type { Client } from "@temporalio/client";
import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type ScheduleDefinition = {
  id: string;
  workflowType: string;
  args: unknown[];
  cronExpression: string;
  taskQueue: string;
  overlap: ScheduleOverlapPolicy;
  memo: string;
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
    id: "golink-sync",
    workflowType: "syncGolinks",
    args: [],
    cronExpression: "*/5 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
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
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
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
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
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
