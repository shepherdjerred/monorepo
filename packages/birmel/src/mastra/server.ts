import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { MastraServer } from "@mastra/hono";
import type { Mastra } from "@mastra/core";
import { logger } from "../utils/logger.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

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

  // Helper function to serve index.html with template variables replaced
  const serveIndex = async (requestUrl?: string) => {
    const indexPath = join(playgroundPath, "index.html");
    let html = await readFile(indexPath, "utf-8");

    // Detect protocol from request URL if available, otherwise use empty string
    // to let the browser use relative protocol (same as page protocol)
    let protocol = "";
    if (requestUrl) {
      try {
        const url = new URL(requestUrl);
        protocol = url.protocol.replace(":", "");
      } catch {
        // If URL parsing fails, leave protocol empty for relative URLs
      }
    }

    // Replace template variables
    html = html
      .replace(/%%MASTRA_STUDIO_BASE_PATH%%/g, "")
      .replace(/%%MASTRA_TELEMETRY_DISABLED%%/g, "true")
      .replace(/%%MASTRA_SERVER_HOST%%/g, options.host)
      .replace(/%%MASTRA_SERVER_PORT%%/g, String(options.port))
      .replace(/%%MASTRA_HIDE_CLOUD_CTA%%/g, "true")
      // Use detected protocol or empty string for protocol-relative URLs
      .replace(/%%MASTRA_SERVER_PROTOCOL%%/g, protocol);

    return html;
  };

  // Serve static assets (CSS, JS, SVG, etc.)
  app.use(
    "/assets/*",
    serveStatic({
      root: playgroundPath,
    })
  );

  app.use(
    "/mastra.svg",
    serveStatic({
      root: playgroundPath,
    })
  );

  // Handle API routes that don't match - return proper JSON error instead of HTML
  app.all("/api/*", (c) => {
    return c.json(
      {
        error: "Not Found",
        message: `API endpoint ${c.req.path} not found`,
        path: c.req.path,
      },
      404
    );
  });

  // Handle all other routes with SPA logic
  app.get("*", async (c) => {
    // For all non-API routes (SPA routes), serve the template-replaced index.html
    // Pass the request URL to detect the protocol (http vs https)
    const html = await serveIndex(c.req.url);
    return c.html(html);
  });

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
