import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "../utils/index.js";
import { getConfig } from "../config/index.js";
import { authRoutes } from "./routes/auth.js";
import { sessionRoutes } from "./routes/sessions.js";
import { verifyToken } from "../auth/index.js";
import { db } from "../db.js";
import { connectionManager, type WSData } from "../websocket/index.js";
import { AgentProxy } from "../agent/index.js";
import { streamRegistry } from "../docker/index.js";

// Store active proxies
const proxies = new Map<string, AgentProxy>();

export function createApp() {
  const app = new Hono();
  const config = getConfig();

  // CORS for frontend
  app.use(
    "/*",
    cors({
      origin: [config.FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  // Health check
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.0.1",
    })
  );

  // Mount routes
  app.route("/auth", authRoutes);
  app.route("/api/sessions", sessionRoutes);

  return app;
}

export async function startServer(port: number) {
  const app = createApp();

  logger.info(`Starting Claude Web server on port ${port}`);

  Bun.serve<WSData>({
    port,

    // HTTP request handler
    async fetch(req, server) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for /ws/sessions/:id
      if (url.pathname.startsWith("/ws/sessions/")) {
        const sessionId = url.pathname.split("/")[3];

        if (!sessionId) {
          return new Response("Session ID required", { status: 400 });
        }

        // Get session token from cookie
        const cookies = req.headers.get("cookie") || "";
        const sessionCookie = cookies
          .split(";")
          .find((c) => c.trim().startsWith("session="));
        const token = sessionCookie?.split("=")[1];

        if (!token) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Verify JWT
        const payload = await verifyToken(token);
        if (!payload) {
          return new Response("Invalid session", { status: 401 });
        }

        // Get session from database
        const session = await db.session.findFirst({
          where: {
            id: sessionId,
            userId: payload.userId as string,
            status: "running",
          },
        });

        if (!session || !session.containerId) {
          return new Response("Session not found or not running", { status: 404 });
        }

        // Upgrade to WebSocket
        const success = server.upgrade(req, {
          data: {
            sessionId: session.id,
            userId: payload.userId as string,
            containerId: session.containerId,
          },
        });

        if (success) {
          return undefined; // Bun handles the response
        }

        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // Handle regular HTTP requests with Hono
      return app.fetch(req);
    },

    // WebSocket handlers
    websocket: {
      open(ws) {
        const { sessionId, userId } = ws.data;
        logger.info("WebSocket connected", { sessionId, userId });

        // Add to connection manager
        connectionManager.add(sessionId, ws);

        // Get the stream from registry
        const stream = streamRegistry.take(sessionId);
        if (!stream) {
          logger.error("No stream found for session", { sessionId });
          ws.send(JSON.stringify({ type: "error", message: "Session not ready" }));
          ws.close(1011, "No stream available");
          return;
        }

        // Create and start agent proxy
        const proxy = new AgentProxy(stream, ws, sessionId);
        proxies.set(sessionId, proxy);
        proxy.start();

        logger.info("Agent proxy started", { sessionId });
      },

      message(ws, message) {
        const { sessionId } = ws.data;
        const proxy = proxies.get(sessionId);

        if (proxy) {
          proxy.handleClientMessage(message.toString());
        } else {
          logger.warn("No proxy for session", { sessionId });
          ws.send(JSON.stringify({ type: "error", message: "Session not connected" }));
        }
      },

      close(ws, code, reason) {
        const { sessionId } = ws.data;
        logger.info("WebSocket closed", { sessionId, code, reason });

        // Cleanup proxy
        const proxy = proxies.get(sessionId);
        if (proxy) {
          proxy.stop();
          proxies.delete(sessionId);
        }

        // Remove from connection manager
        connectionManager.remove(sessionId);
      },
    },
  });

  logger.info(`Server running at http://localhost:${port}`);
  logger.info("Endpoints:");
  logger.info("  GET  /health                   - Health check");
  logger.info("  GET  /auth/github              - Start GitHub OAuth");
  logger.info("  GET  /auth/github/callback     - OAuth callback");
  logger.info("  POST /auth/logout              - Logout");
  logger.info("  GET  /auth/me                  - Get current user");
  logger.info("  GET  /api/sessions             - List sessions");
  logger.info("  POST /api/sessions             - Create session");
  logger.info("  GET  /api/sessions/:id         - Get session");
  logger.info("  DELETE /api/sessions/:id       - Stop session");
  logger.info("  POST /api/sessions/:id/commit  - Commit changes");
  logger.info("  POST /api/sessions/:id/push    - Push to remote");
  logger.info("  POST /api/sessions/:id/pr      - Create PR");
  logger.info("  WS   /ws/sessions/:id          - Agent WebSocket");
}
