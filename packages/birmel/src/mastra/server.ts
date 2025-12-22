import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { MastraServer } from "@mastra/hono";
import type { Mastra } from "@mastra/core";
import { logger } from "../utils/logger.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Get the path to the Mastra playground UI
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const playgroundPath = join(
  __dirname,
  "../../node_modules/mastra/dist/playground"
);

/**
 * Start the Mastra server programmatically using Hono.
 * This allows running Mastra Studio without using the buggy CLI build process.
 * Now includes the Studio UI served from the mastra package.
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

  // Serve Studio UI static files
  app.use(
    "/*",
    serveStatic({
      root: playgroundPath,
      rewriteRequestPath: (path) => {
        // For SPA routing, serve index.html for all non-asset paths
        if (
          !path.startsWith("/api") &&
          !path.startsWith("/assets") &&
          !path.includes(".")
        ) {
          return "/index.html";
        }
        return path;
      },
    })
  );

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
