import { Hono } from "hono";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";
import { getGitHubConfig, isGitHubConfigured } from "./config.ts";
import { exchangeCodeForToken, storeAuth } from "./github-oauth.ts";

const logger = loggers.editor.child("oauth-routes");

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/**
 * Create OAuth routes for GitHub authentication
 */
export function createOAuthRoutes(): Hono {
  const app = new Hono();

  // GET /auth/github - Redirect to GitHub OAuth
  app.get("/github", (c) => {
    if (!isGitHubConfigured()) {
      return c.json({ error: "GitHub OAuth not configured" }, 500);
    }

    const config = getGitHubConfig();
    if (config == null) {
      return c.json({ error: "GitHub OAuth not configured" }, 500);
    }
    const userId = c.req.query("user");

    if (userId == null || userId.length === 0) {
      return c.json({ error: "Missing user parameter" }, 400);
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      scope: "repo",
      state: userId, // Pass Discord user ID as state
    });

    const authUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;

    logger.info("Redirecting to GitHub OAuth", { userId });

    return c.redirect(authUrl);
  });

  // GET /auth/github/callback - Handle OAuth callback
  app.get("/github/callback", async (c) => {
    if (!isGitHubConfigured()) {
      return c.json({ error: "GitHub OAuth not configured" }, 500);
    }

    const code = c.req.query("code");
    const state = c.req.query("state"); // Discord user ID
    const error = c.req.query("error");

    if (error != null && error.length > 0) {
      logger.error("GitHub OAuth error", undefined, {
        error,
        description: c.req.query("error_description"),
      });
      return c.html(renderErrorPage(error, c.req.query("error_description")));
    }

    if (code == null || code.length === 0) {
      return c.html(
        renderErrorPage("missing_code", "No authorization code received"),
      );
    }

    if (state == null || state.length === 0) {
      return c.html(renderErrorPage("missing_state", "No user state received"));
    }

    try {
      // Exchange code for token
      const tokenResult = await exchangeCodeForToken(code);

      // Store the token for this Discord user
      await storeAuth(
        state, // Discord user ID
        tokenResult.accessToken,
        tokenResult.refreshToken,
        tokenResult.expiresAt,
      );

      logger.info("GitHub OAuth successful", { userId: state });

      return c.html(renderSuccessPage());
    } catch (error_) {
      logger.error("Failed to exchange OAuth code", error_);
      return c.html(
        renderErrorPage("token_exchange_failed", (error_ as Error).message),
      );
    }
  });

  // GET /auth/github/status - Check auth status for a user
  app.get("/github/status", async (c) => {
    const userId = c.req.query("user");

    if (userId == null || userId.length === 0) {
      return c.json({ error: "Missing user parameter" }, 400);
    }

    const { hasValidAuth } = await import("./github-oauth.js");
    const isAuthed = await hasValidAuth(userId);

    return c.json({ authenticated: isAuthed });
  });

  return app;
}

function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>GitHub Connected - Birmel</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: #16213e;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .success-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 { color: #57f287; margin-bottom: 0.5rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">&#10003;</div>
    <h1>GitHub Connected!</h1>
    <p>You can now close this window and return to Discord.</p>
    <p>Your pull requests will be created under your GitHub account.</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(error: string, description?: string | null): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Error - Birmel</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: #16213e;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .error-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 { color: #ed4245; margin-bottom: 0.5rem; }
    p { color: #aaa; }
    code { background: #0d1117; padding: 0.2rem 0.5rem; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">&#10007;</div>
    <h1>Authentication Failed</h1>
    <p><code>${error}</code></p>
    ${description != null && description.length > 0 ? `<p>${description}</p>` : ""}
    <p>Please try again from Discord.</p>
  </div>
</body>
</html>`;
}
