import { checkMatchHistory } from "@shepherdjerred/scout-backend/league/tasks/postmatch/match-history-polling.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("tasks-postmatch");

export async function checkPostMatch() {
  logger.info("🏁 Starting post-match check task");
  const startTime = Date.now();

  try {
    await checkMatchHistory();

    const executionTime = Date.now() - startTime;
    logger.info(`✅ Post-match check completed successfully in ${executionTime.toString()}ms`);
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(`❌ Post-match check failed after ${executionTime.toString()}ms:`, error);
    throw error;
  }
}
