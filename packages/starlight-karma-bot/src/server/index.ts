import configuration from "../configuration.ts";
import { join } from "node:path";

console.log(`[Server] Starting HTTP server on port ${configuration.port.toString()}...`);

Bun.serve({
  port: configuration.port,
  async fetch(req) {
    const url = new URL(req.url);

    console.log(`[Server] ${req.method} ${url.pathname}`);

    if (url.pathname === "/") {
      return new Response("Hello :)");
    }

    if (url.pathname === "/ping") {
      return new Response("pong");
    }

    // Serve static files from dataDir
    try {
      const filePath = join(configuration.dataDir, url.pathname);
      const file = Bun.file(filePath);

      if (await file.exists()) {
        console.log(`[Server] Serving static file: ${filePath}`);
        return new Response(file);
      }

      console.log(`[Server] File not found: ${filePath}`);
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(`[Server] Error serving file:`, error);
      return new Response("Not Found", { status: 404 });
    }
  },
});

console.log(`[Server] HTTP server listening on http://localhost:${configuration.port.toString()}`);
