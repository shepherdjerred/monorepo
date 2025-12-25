import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchGitHubEmail,
  signToken,
  encryptToken,
} from "../../auth/index.js";
import { db } from "../../db.js";
import { getConfig } from "../../config/index.js";
import { logger } from "../../utils/index.js";
import { requireAuth } from "../middleware/auth.js";

const auth = new Hono();

/**
 * GET /auth/github
 * Initiates GitHub OAuth flow by redirecting to GitHub
 */
auth.get("/github", (c) => {
  // Generate random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in cookie for validation on callback
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: getConfig().NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const authUrl = getAuthorizationUrl(state);
  logger.info("Redirecting to GitHub OAuth", { state });

  return c.redirect(authUrl);
});

/**
 * GET /auth/github/callback
 * Handles OAuth callback from GitHub
 */
auth.get("/github/callback", async (c) => {
  const config = getConfig();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "oauth_state");
  const error = c.req.query("error");

  // Clear OAuth state cookie
  deleteCookie(c, "oauth_state");

  // Handle OAuth errors
  if (error) {
    logger.error("GitHub OAuth error", { error });
    return c.redirect(`${config.FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
  }

  // Validate state for CSRF protection
  if (!state || !storedState || state !== storedState) {
    logger.error("OAuth state mismatch", { state, storedState });
    return c.redirect(`${config.FRONTEND_URL}/login?error=invalid_state`);
  }

  // Validate code
  if (!code) {
    logger.error("No authorization code received");
    return c.redirect(`${config.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await exchangeCodeForToken(code);
    const accessToken = tokenResponse.access_token;

    // Fetch user profile
    const githubUser = await fetchGitHubUser(accessToken);

    // Fetch email if not in profile
    let email = githubUser.email;
    if (!email) {
      email = await fetchGitHubEmail(accessToken);
    }

    // Encrypt the GitHub token for storage
    const encryptedToken = encryptToken(accessToken);

    // Upsert user in database
    const user = await db.user.upsert({
      where: { githubId: String(githubUser.id) },
      update: {
        username: githubUser.login,
        email,
        avatarUrl: githubUser.avatar_url,
        accessToken: encryptedToken,
      },
      create: {
        githubId: String(githubUser.id),
        username: githubUser.login,
        email,
        avatarUrl: githubUser.avatar_url,
        accessToken: encryptedToken,
      },
    });

    logger.info("User authenticated", { userId: user.id, username: user.username });

    // Create JWT session token
    const sessionToken = await signToken({
      userId: user.id,
      githubId: user.githubId,
      username: user.username,
    });

    // Set session cookie
    setCookie(c, "session", sessionToken, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    // Redirect to frontend
    return c.redirect(`${config.FRONTEND_URL}/`);
  } catch (err) {
    logger.error("OAuth callback error", err);
    return c.redirect(`${config.FRONTEND_URL}/login?error=auth_failed`);
  }
});

/**
 * POST /auth/logout
 * Clears the session cookie
 */
auth.post("/logout", (c) => {
  deleteCookie(c, "session");
  return c.json({ success: true });
});

/**
 * GET /auth/me
 * Returns the current authenticated user
 */
auth.get("/me", requireAuth, async (c) => {
  const auth = c.get("auth");

  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

export { auth as authRoutes };
