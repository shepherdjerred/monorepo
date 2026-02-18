import { Hono } from "hono";
import { loggers } from "@shepherdjerred/birmel/utils/index.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { createOAuthRoutes } from "./oauth-routes.ts";
import {
  checkClaudePrerequisites,
  checkGhPrerequisites,
} from "./claude-client.ts";

const logger = loggers.editor.child("oauth-server");

let server: ReturnType<typeof Bun.serve> | null = null;

/**
 * Start a minimal OAuth-only server for GitHub authentication.
 * This server should be exposed via Tailscale Funnel for public access.
 *
 * Runs on a separate port from the Mastra Studio server.
 */
export async function startOAuthServer(): Promise<void> {
  const config = getConfig();

  if (!config.editor.enabled) {
    logger.info("Editor disabled, skipping OAuth server");
    return;
  }

  // Check prerequisites and warn if missing
  const claudeCheck = await checkClaudePrerequisites();
  if (claudeCheck.installed) {
    logger.info("Claude Code CLI found", { version: claudeCheck.version });
    if (!claudeCheck.hasApiKey) {
      logger.warn(
        "ANTHROPIC_API_KEY not set - run 'claude login' or set the env var",
      );
    }
  } else {
    logger.warn(
      "Claude Code CLI not installed - editor feature will not work",
      {
        installCmd: "curl -fsSL https://claude.ai/install.sh | bash",
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
