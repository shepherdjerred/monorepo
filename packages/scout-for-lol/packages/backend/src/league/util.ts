import * as Sentry from "@sentry/bun";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("league-util");

export function logErrors(fn: () => Promise<unknown>, jobName?: string) {
  return async () => {
    const functionName = jobName ?? (fn.name || "anonymous");
    logger.info(`🔄 Executing function: ${functionName}`);

    try {
      const startTime = Date.now();
      await fn();
      const executionTime = Date.now() - startTime;
      logger.info(
        `✅ Function ${functionName} completed successfully in ${executionTime.toString()}ms`,
      );
    } catch (error) {
      logger.error(`❌ Function ${functionName} failed:`, error);

      // Log additional error context
      const ErrorDetailsSchema = z.object({
        name: z.string(),
        message: z.string(),
        stack: z.string().optional(),
      });
      const errorResult = ErrorDetailsSchema.safeParse(error);
      if (errorResult.success) {
        logger.error(`❌ Error name: ${errorResult.data.name}`);
        logger.error(`❌ Error message: ${errorResult.data.message}`);
        if (
          errorResult.data.stack !== undefined &&
          errorResult.data.stack.length > 0
        ) {
          logger.error(`❌ Error stack: ${errorResult.data.stack}`);
        }
      }

      // When createCronJob hands us its jobName, surface it as a Sentry
      // tag so triage can identify which cron failed. The legacy `function`
      // tag stays for back-compat with existing Bugsink filters.
      Sentry.captureException(error, {
        tags: {
          function: functionName,
          jobName: jobName ?? functionName,
          source: "cron-job",
        },
      });

      // Re-throw to maintain original behavior
      throw error;
    }
  };
}
