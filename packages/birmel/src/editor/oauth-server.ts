import { Hono } from "hono";
import { loggers } from "../utils/index.js";
import { getConfig } from "../config/index.js";
import { createOAuthRoutes } from "./oauth-routes.js";
import { checkClaudePrerequisites, checkGhPrerequisites } from "./claude-client.js";

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
  if (!claudeCheck.installed) {
    logger.warn("Claude Code CLI not installed - editor feature will not work", {
      installCmd: "curl -fsSL https://claude.ai/install.sh | bash",
    });
  } else {
    logger.info("Claude Code CLI found", { version: claudeCheck.version });
    if (!claudeCheck.hasApiKey) {
      logger.warn("ANTHROPIC_API_KEY not set - run 'claude login' or set the env var");
    }
  }

  const ghCheck = await checkGhPrerequisites();
  if (!ghCheck.installed) {
    logger.warn("GitHub CLI (gh) not installed - PR creation will not work", {
      installCmd: "brew install gh",
    });
  } else if (!ghCheck.authenticated) {
    logger.warn("GitHub CLI not authenticated - run 'gh auth login'");
  } else {
    logger.info("GitHub CLI authenticated");
  }

  if (!config.editor.github) {
    logger.info("GitHub OAuth not configured, skipping OAuth server");
    return;
  }

  const port = config.editor.oauthPort ?? 4112;
  const host = config.editor.oauthHost ?? "0.0.0.0";

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
    url: `http://${host}:${port}`,
  });
}

/**
 * Stop the OAuth server
 */
export async function stopOAuthServer(): Promise<void> {
  if (server) {
    server.stop();
    server = null;
    logger.info("OAuth server stopped");
  }
}
