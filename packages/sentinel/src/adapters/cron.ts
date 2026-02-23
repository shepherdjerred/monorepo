import { CronJob } from "cron";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";

const cronLogger = logger.child({ module: "cron-adapter" });
const runningJobs: CronJob[] = [];

export function startCronJobs(
  registry: Map<string, AgentDefinition>,
): void {
  for (const [name, agent] of registry) {
    for (const trigger of agent.triggers) {
      if (trigger.type !== "cron") {
        continue;
      }

      cronLogger.info(
        { agent: name, schedule: trigger.schedule },
        "Registering cron trigger",
      );

      const job = new CronJob(
        trigger.schedule,
        () => {
          void enqueueCronJob(name, trigger.prompt);
        },
        null,
        true,
        "UTC",
        null,
        false,
      );

      runningJobs.push(job);
    }
  }

  cronLogger.info(
    { totalJobs: runningJobs.length },
    "Cron jobs started",
  );
}

async function enqueueCronJob(
  agent: string,
  prompt: string,
): Promise<void> {
  try {
    cronLogger.info({ agent }, "Cron trigger fired");
    await enqueueJob({
      agent,
      prompt,
      triggerType: "cron",
      triggerSource: agent,
    });
    cronLogger.info({ agent }, "Cron job enqueued");
  } catch (error: unknown) {
    cronLogger.error({ agent, error }, "Failed to enqueue cron job");
  }
}

export function stopCronJobs(): void {
  for (const job of runningJobs) {
    void job.stop();
  }
  const count = runningJobs.length;
  runningJobs.length = 0;
  cronLogger.info({ stopped: count }, "Cron jobs stopped");
}

/**
 * Parse a cron schedule string and return the interval in milliseconds.
 * Supports standard 5-field cron expressions.
 */
function parseCronIntervalMs(schedule: string): number | null {
  try {
    // Create a CronJob to leverage its built-in parsing to determine the interval
    // by computing the difference between two consecutive ticks
    const noop = (): void => {
      // no-op: CronJob requires a callback but we only use it for schedule parsing
    };
    const job = new CronJob(schedule, noop);
    const nextDates = job.nextDates(2);
    if (Array.isArray(nextDates) && nextDates.length === 2) {
      const first = nextDates[0];
      const second = nextDates[1];
      if (first != null && second != null) {
        return second.toMillis() - first.toMillis();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * On startup, check each cron-triggered agent for missed runs.
 * If the gap since the last cron job exceeds 2x the cron interval,
 * enqueue a catch-up job.
 */
export async function recoverMissedJobs(
  registry: Map<string, AgentDefinition>,
): Promise<void> {
  const prisma = getPrisma();

  for (const [name, agent] of registry) {
    for (const trigger of agent.triggers) {
      if (trigger.type !== "cron") {
        continue;
      }

      try {
        const lastCronJob = await prisma.job.findFirst({
          where: { agent: name, triggerType: "cron" },
          orderBy: { createdAt: "desc" },
        });

        const intervalMs = parseCronIntervalMs(trigger.schedule);
        if (intervalMs == null) {
          cronLogger.warn(
            { agent: name, schedule: trigger.schedule },
            "Could not parse cron interval for missed job recovery",
          );
          continue;
        }

        const threshold = intervalMs * 2;
        const gapMs = lastCronJob == null
          ? threshold + 1 // No previous run, treat as missed
          : Date.now() - lastCronJob.createdAt.getTime();

        if (gapMs > threshold) {
          cronLogger.info(
            {
              agent: name,
              gapMs,
              thresholdMs: threshold,
              lastRun: lastCronJob?.createdAt.toISOString() ?? "never",
            },
            "Missed cron job detected, enqueuing catch-up",
          );

          await enqueueJob({
            agent: name,
            prompt: trigger.prompt,
            triggerType: "cron",
            triggerSource: `${name}:recovery`,
          });
        }
      } catch (error: unknown) {
        cronLogger.error(
          { agent: name, error },
          "Failed to check for missed cron jobs",
        );
      }
    }
  }
}
