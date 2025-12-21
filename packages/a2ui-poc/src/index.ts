import { startServer } from "./server/index.js";
import { getConfig } from "./config/index.js";
import { logger } from "./utils/index.js";

async function main() {
  try {
    const config = getConfig();
    logger.setLevel(config.logLevel);

    logger.info("Starting A2UI POC...");
    logger.info(`Using model: ${config.anthropic.model}`);

    await startServer(config.server.port);

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   A2UI POC Server                         ║
╠═══════════════════════════════════════════════════════════╣
║  Backend API: http://localhost:${config.server.port.toString().padEnd(28)}║
║                                                           ║
║  Endpoints:                                               ║
║    GET  /health           - Health check                  ║
║    POST /api/a2ui/explore - Explore topic (streaming)     ║
║    POST /api/a2ui/action  - Handle user action            ║
║                                                           ║
║  To start frontend:                                       ║
║    cd frontend && bun run dev                             ║
║                                                           ║
║  Then open: http://localhost:5173                         ║
╚═══════════════════════════════════════════════════════════╝
    `);
  } catch (error) {
    logger.error("Fatal error", error);
    process.exit(1);
  }
}

main();
