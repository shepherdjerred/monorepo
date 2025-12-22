import { Hono } from "hono";
import { MastraServer } from "@mastra/hono";
import type { Mastra } from "@mastra/core";
import { logger } from "../utils/logger.js";

/**
 * Start the Mastra server programmatically using Hono.
 * This allows running Mastra Studio without using the buggy CLI build process.
 */
export async function createAndStartServer(
  mastra: Mastra,
  options: { port: number; host: string }
): Promise<void> {
  const app = new Hono();

  const server = new MastraServer({
    app,
    mastra,
  });

  // Initialize routes (registers all Mastra endpoints)
  await server.init();

  // Start the server using Bun's native server
  Bun.serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.host,
  });

  logger.info("Mastra Studio server started", {
    port: options.port,
    host: options.host,
    url: `http://${options.host}:${String(options.port)}`,
  });
}
