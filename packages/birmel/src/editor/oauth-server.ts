import { Hono } from "hono";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { createOAuthRoutes } from "./oauth-routes.ts";
import {
  checkCodexPrerequisites,
  checkGhPrerequisites,
} from "./codex-client.ts";

const logger = loggers.editor.child("oauth-server");

let server: ReturnType<typeof Bun.serve> | null = null;

/**
 * Start a minimal OAuth-only server for GitHub authentication.
 * This server is exposed via Tailscale Funnel + a Cloudflare tunnel binding
 * so users can complete the GitHub OAuth dance from outside the homelab.
 */
export async function startOAuthServer(): Promise<void> {
  const config = getConfig();

  if (!config.editor.enabled) {
    logger.info("Editor disabled, skipping OAuth server");
    return;
  }

  // Check prerequisites and warn if missing
  const codexCheck = checkCodexPrerequisites();
  if (codexCheck.installed) {
    logger.info("Codex Agent SDK available", { version: codexCheck.version });
    if (!codexCheck.hasApiKey) {
      logger.warn(
        "OPENROUTER_API_KEY not set - configure the editor OpenRouter key",
      );
    }
  } else {
    logger.warn(
      "Codex Agent SDK is unavailable - editor feature will not work",
      {
        dependency: "@openai/codex-sdk",
      },
    );
  }

  const ghCheck = await checkGhPrerequisites();
  if (ghCheck.installed) {
    logger.info("GitHub CLI found (per-user OAuth tokens used for auth)");
  } else {
    logger.warn("GitHub CLI (gh) not installed - PR creation will not work", {
      installCmd: "brew install gh",
    });
  }

  if (config.editor.github == null) {
    logger.info("GitHub OAuth not configured, skipping OAuth server");
    return;
  }

  const port = config.editor.oauthPort;
  const host = config.editor.oauthHost;

  const app = new Hono();

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Mount OAuth routes under /auth
  app.route("/auth", createOAuthRoutes());

  // Catch-all for anything else
  app.all("*", (c) => {
    return c.json({ error: "Not found" }, 404);
  });

  server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  logger.info("OAuth server started", {
    port,
    host,
    url: `http://${host}:${String(port)}`,
  });
}

/**
 * Stop the OAuth server
 */
export async function stopOAuthServer(): Promise<void> {
  if (server != null) {
    await server.stop();
    server = null;
    logger.info("OAuth server stopped");
  }
}
