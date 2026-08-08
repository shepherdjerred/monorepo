import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { checkAndSendDailyPosts } from "./daily-posts.ts";
import { aggregateActivityMetrics } from "./jobs/activity-aggregator.ts";
import { checkAndPostBirthdays } from "./jobs/birthday-checker.ts";
import {
  checkAndEndElections,
  checkAndStartElections,
  processElectionResults,
} from "./jobs/elections.ts";
import { runAgentJobsJob, waitForActiveAgentJobs } from "./jobs/agent-jobs.ts";

const logger = loggers.scheduler;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerTick: Promise<void> | null = null;
let schedulerStarted = false;

export async function waitUntilSettled(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([settleOperation(operation), timedOut]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function settleOperation(operation: Promise<void>): Promise<true> {
  try {
    await operation;
  } catch (error) {
    logger.error("Scheduler operation rejected during shutdown", {
      error: getErrorMessage(error),
    });
  }
  return true;
}

async function runSchedulerOperations(): Promise<void> {
  const config = getConfig();
  const operations: { name: string; operation: Promise<void> }[] = [
    { name: "birthdays", operation: checkAndPostBirthdays() },
    { name: "activity", operation: aggregateActivityMetrics() },
    { name: "election-start", operation: checkAndStartElections() },
    { name: "election-end", operation: checkAndEndElections() },
    { name: "election-results", operation: processElectionResults() },
    { name: "agent-jobs", operation: runAgentJobsJob() },
  ];
  if (config.dailyPosts.enabled) {
    operations.push({
      name: "daily-posts",
      operation: checkAndSendDailyPosts(),
    });
  }
  await Promise.all(
    operations.map(async ({ name, operation }) => {
      const settled = await waitUntilSettled(
        operation,
        config.scheduler.operationTimeoutMs,
      );
      if (!settled) {
        logger.error("Scheduled operation timed out", {
          operation: name,
          timeoutMs: config.scheduler.operationTimeoutMs,
        });
      }
    }),
  );
}

export function runSchedulerTick(): Promise<void> {
  if (schedulerTick != null) {
    return schedulerTick;
  }
  const tick = runSchedulerOperations();
  schedulerTick = tick;
  void clearSchedulerTick(tick);
  return tick;
}

async function clearSchedulerTick(tick: Promise<void>): Promise<void> {
  try {
    await tick;
  } catch (error) {
    logger.error("Scheduler tick failed", { error: getErrorMessage(error) });
  } finally {
    if (schedulerTick === tick) {
      schedulerTick = null;
    }
  }
}

export function startScheduler(): void {
  const config = getConfig();
  if (!config.scheduler.enabled) {
    schedulerStarted = true;
    logger.info("Scheduler is disabled");
    return;
  }
  if (schedulerInterval != null) {
    logger.warn("Scheduler is already running");
    return;
  }

  schedulerInterval = setInterval(() => {
    void runSchedulerTick();
  }, config.scheduler.tickIntervalMs);
  schedulerStarted = true;
  void runSchedulerTick();
  logger.info("Scheduler started", {
    tickIntervalMs: config.scheduler.tickIntervalMs,
  });
}

export function isSchedulerStarted(): boolean {
  return schedulerStarted;
}

export async function stopScheduler(): Promise<void> {
  if (schedulerInterval != null) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  const timeoutMs = getConfig().scheduler.shutdownTimeoutMs;
  const shutdownDeadline = Date.now() + timeoutMs;
  const schedulerWork = schedulerTick;
  if (schedulerWork != null) {
    await waitUntilSettled(
      schedulerWork,
      Math.max(0, shutdownDeadline - Date.now()),
    );
  }
  const drained = await waitForActiveAgentJobs(
    Math.max(0, shutdownDeadline - Date.now()),
  );
  schedulerStarted = false;
  if (!drained) {
    logger.error("Scheduler shutdown timed out with active jobs", {
      timeoutMs,
    });
    return;
  }
  logger.info("Scheduler stopped");
}
