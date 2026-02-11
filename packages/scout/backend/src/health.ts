import { strict as assert } from "assert";
import configuration from "@shepherdjerred/scout-backend/configuration.ts";
import { ErrorSchema } from "@shepherdjerred/scout-backend/utils/errors.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("health");

logger.info("🏥 Starting health check");
logger.info(`🔍 Health check URL: http://127.0.0.1:${configuration.port.toString()}/ping`);

// health check used by Docker
try {
  const startTime = Date.now();

  const response = await fetch(`http://127.0.0.1:${configuration.port.toString()}/ping`);

  const responseTime = Date.now() - startTime;
  logger.info(`📊 Health check response time: ${responseTime.toString()}ms`);
  logger.info(`📋 HTTP Status: ${response.status.toString()}`);

  assert(response.ok);
  logger.info("✅ Health check passed");
  process.exit(0);
} catch (error) {
  logger.error("❌ Health check failed:", error);

  const errorResult = ErrorSchema.safeParse(error);
  if (errorResult.success) {
    logger.error(`❌ Error message: ${errorResult.data.message}`);
  }

  process.exit(1);
}
