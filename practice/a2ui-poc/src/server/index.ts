import { Hono } from "hono";
import { cors } from "hono/cors";
import { KnowledgeAgent } from "../agent/index.js";
import { logger } from "../utils/index.js";
import type { A2UIMessage, UserAction } from "../a2ui/types.js";

export function createApp() {
  const app = new Hono();

  // CORS for frontend
  app.use(
    "/*",
    cors({
      origin: ["http://localhost:5173", "http://localhost:3000"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // A2UI streaming endpoint for topic exploration
  app.post("/api/a2ui/explore", async (c) => {
    const body = await c.req.json<{ query: string }>();
    const { query } = body;

    if (!query || typeof query !== "string") {
      return c.json({ error: "Query is required" }, 400);
    }

    logger.info("A2UI explore request", { query });

    const agent = new KnowledgeAgent();

    // Create a streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          for await (const message of agent.exploreTopic(query)) {
            const line = JSON.stringify(message) + "\n";
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (error) {
          logger.error("A2UI streaming error", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  // User action handler
  app.post("/api/a2ui/action", async (c) => {
    const body = await c.req.json<{ userAction: UserAction["userAction"] }>();
    const { userAction } = body;

    if (!userAction || !userAction.name) {
      return c.json({ error: "userAction is required" }, 400);
    }

    logger.info("A2UI action request", { action: userAction.name });

    const agent = new KnowledgeAgent();
    const messages: A2UIMessage[] = [];

    try {
      for await (const message of agent.handleUserAction(userAction)) {
        messages.push(message);
      }
      return c.json({ messages });
    } catch (error) {
      logger.error("A2UI action error", error);
      return c.json({ error: "Action handling failed" }, 500);
    }
  });

  // Streaming action handler (for longer operations)
  app.post("/api/a2ui/action/stream", async (c) => {
    const body = await c.req.json<{ userAction: UserAction["userAction"] }>();
    const { userAction } = body;

    if (!userAction || !userAction.name) {
      return c.json({ error: "userAction is required" }, 400);
    }

    logger.info("A2UI streaming action request", { action: userAction.name });

    const agent = new KnowledgeAgent();

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          for await (const message of agent.handleUserAction(userAction)) {
            const line = JSON.stringify(message) + "\n";
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (error) {
          logger.error("A2UI streaming action error", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return app;
}

export async function startServer(port: number) {
  const app = createApp();

  logger.info(`Starting A2UI POC server on port ${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
    idleTimeout: 60, // 60 seconds for AI generation
  });

  logger.info(`Server running at http://localhost:${port}`);
  logger.info(`Endpoints:`);
  logger.info(`  GET  /health              - Health check`);
  logger.info(`  POST /api/a2ui/explore    - Explore a topic (streaming)`);
  logger.info(`  POST /api/a2ui/action     - Handle user action`);
}
