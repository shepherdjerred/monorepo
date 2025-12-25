import { getConfig } from "./config/index.js";
import { startServer } from "./server/index.js";
import { logger } from "./utils/index.js";

async function main() {
  try {
    const config = getConfig();
    await startServer(config.PORT);
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

main();
