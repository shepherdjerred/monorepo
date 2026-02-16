import * as Sentry from "@sentry/bun";
import { z } from "zod";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("league-util");

export function logErrors(fn: () => Promise<unknown>) {
  return async () => {
    const functionName = fn.name || "anonymous";
    logger.info(`🔄 Executing function: ${functionName}`);

    try {
      const startTime = Date.now();
      await fn();
      const executionTime = Date.now() - startTime;
      logger.info(
        `✅ Function ${functionName} completed successfully in ${executionTime.toString()}ms`,
      );
    } catch (e) {
      logger.error(`❌ Function ${functionName} failed:`, e);

      // Log additional error context
      const ErrorDetailsSchema = z.object({
        name: z.string(),
        message: z.string(),
        stack: z.string().optional(),
      });
      const errorResult = ErrorDetailsSchema.safeParse(e);
      if (errorResult.success) {
        logger.error(`❌ Error name: ${errorResult.data.name}`);
        logger.error(`❌ Error message: ${errorResult.data.message}`);
        if (errorResult.data.stack) {
          logger.error(`❌ Error stack: ${errorResult.data.stack}`);
        }
      }

      // Send to Sentry with additional context
      Sentry.captureException(e, {
        tags: {
          function: functionName,
          source: "cron-job",
        },
      });

      // Re-throw to maintain original behavior
      throw e;
    }
  };
}
