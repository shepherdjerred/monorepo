import { CronJob } from "cron";
import { logErrors } from "@shepherdjerred/scout-backend/league/util.ts";
import { cronJobExecutionsTotal, cronJobDuration, cronJobLastSuccess } from "@shepherdjerred/scout-backend/metrics/index.ts";
import { logCronTrigger } from "@shepherdjerred/scout-backend/utils/notification-logger.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("cron-helpers");

type CronJobConfig = {
  schedule: string;
  jobName: string;
  task: () => Promise<void>;
  logMessage: string;
  timezone?: string;
  runOnInit?: boolean;
  logTrigger?: string;
};

/**
 * Create a cron job with common patterns for timing, metrics, logging, and error handling
 */
export function createCronJob(config: CronJobConfig): CronJob {
  const {
    schedule,
    jobName,
    task,
    logMessage,
    timezone = "America/Los_Angeles",
    runOnInit = true,
    logTrigger,
  } = config;

  return new CronJob(
    schedule,
    logErrors(async () => {
      const startTime = Date.now();
      logger.info(logMessage);

      if (logTrigger) {
        logCronTrigger(jobName, logTrigger);
      }

      try {
        await task();
        const executionTime = Date.now() - startTime;
        const executionTimeSeconds = executionTime / 1000;
        logger.info(`✅ ${jobName} completed in ${executionTime.toString()}ms`);

        // Record successful execution metrics
        cronJobExecutionsTotal.inc({ job_name: jobName, status: "success" });
        cronJobDuration.observe({ job_name: jobName }, executionTimeSeconds);
        cronJobLastSuccess.set({ job_name: jobName }, Date.now() / 1000);
      } catch (error) {
        const executionTime = Date.now() - startTime;
        const executionTimeSeconds = executionTime / 1000;

        // Record failed execution metrics
        cronJobExecutionsTotal.inc({ job_name: jobName, status: "error" });
        cronJobDuration.observe({ job_name: jobName }, executionTimeSeconds);
        throw error;
      }
    }),
    null,
    true,
    timezone,
    null,
    runOnInit,
  );
}
