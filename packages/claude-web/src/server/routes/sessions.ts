import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db.js";
import { containerManager, streamRegistry } from "../../docker/index.js";
import { decryptToken } from "../../auth/index.js";
import { logger } from "../../utils/index.js";
import { requireAuth } from "../middleware/auth.js";

const sessions = new Hono();

// Apply auth middleware to all routes
sessions.use("*", requireAuth);

// Request body schemas
const createSessionSchema = z.object({
  repoUrl: z.string().url().startsWith("https://github.com/"),
  baseBranch: z.string().min(1).max(255).default("main"), // Branch to base work on
});

/**
 * Generate a unique branch name for the session
 */
function generateBranchName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `claude/${timestamp}-${random}`;
}

const commitSchema = z.object({
  message: z.string().min(1).max(500),
});

const prSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10000).default(""),
});

/**
 * GET /api/sessions
 * List all sessions for the current user
 */
sessions.get("/", async (c) => {
  const auth = c.get("auth");

  const userSessions = await db.session.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      repoUrl: true,
      branch: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ sessions: userSessions });
});

/**
 * POST /api/sessions
 * Create a new session and spawn a container
 */
sessions.post("/", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { repoUrl, baseBranch } = parsed.data;

  // Get user with access token
  const user = await db.user.findUnique({
    where: { id: auth.userId },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Generate a unique working branch name
  const branch = generateBranchName();

  // Create session in database
  const session = await db.session.create({
    data: {
      userId: auth.userId,
      repoUrl,
      baseBranch,
      branch,
      status: "pending",
    },
  });

  logger.info("Creating new session", { sessionId: session.id, repoUrl, baseBranch, branch });

  try {
    // Decrypt GitHub token
    const githubToken = decryptToken(user.accessToken);

    // Create, attach, and start container
    const { container, stream } = await containerManager.createSandbox({
      sessionId: session.id,
      userId: auth.userId,
      repoUrl,
      baseBranch,
      branch,
      githubToken,
      userName: user.username,
      userEmail: user.email || `${user.username}@users.noreply.github.com`,
    });

    // Store the stream for the WebSocket handler to use later
    streamRegistry.set(session.id, stream);

    // Update session with container ID and status
    const updatedSession = await db.session.update({
      where: { id: session.id },
      data: {
        containerId: container.id,
        status: "running",
      },
    });

    return c.json({ session: updatedSession }, 201);
  } catch (error) {
    // Update session status to error
    await db.session.update({
      where: { id: session.id },
      data: { status: "error" },
    });

    logger.error("Failed to create container", { sessionId: session.id, error });
    return c.json({ error: "Failed to start session" }, 500);
  }
});

/**
 * GET /api/sessions/:id
 * Get a specific session
 */
sessions.get("/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId },
  });

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Get container status if running
  let containerInfo = null;
  if (session.containerId) {
    containerInfo = await containerManager.getContainerInfo(session.containerId);
  }

  return c.json({ session, container: containerInfo });
});

/**
 * DELETE /api/sessions/:id
 * Stop and remove a session
 */
sessions.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId },
  });

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Stop container if running
  if (session.containerId) {
    await containerManager.stopContainer(session.containerId);
  }

  // Update session status
  await db.session.update({
    where: { id: sessionId },
    data: { status: "stopped" },
  });

  logger.info("Session stopped", { sessionId });

  return c.json({ success: true });
});

/**
 * POST /api/sessions/:id/commit
 * Commit current changes in the container
 */
sessions.post("/:id/commit", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = await c.req.json();

  const parsed = commitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId, status: "running" },
  });

  if (!session || !session.containerId) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  try {
    // Stage all changes
    await containerManager.execInContainer(session.containerId, ["git", "add", "-A"]);

    // Commit
    const output = await containerManager.execInContainer(session.containerId, [
      "git",
      "commit",
      "-m",
      parsed.data.message,
    ]);

    // Get commit SHA
    const sha = await containerManager.execInContainer(session.containerId, [
      "git",
      "rev-parse",
      "HEAD",
    ]);

    return c.json({ success: true, sha: sha.trim(), output });
  } catch (error) {
    logger.error("Failed to commit", { sessionId, error });
    return c.json({ error: "Failed to commit changes" }, 500);
  }
});

/**
 * POST /api/sessions/:id/push
 * Push commits to remote
 */
sessions.post("/:id/push", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId, status: "running" },
  });

  if (!session || !session.containerId) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  try {
    const output = await containerManager.execInContainer(session.containerId, [
      "git",
      "push",
      "-u",
      "origin",
      session.branch,
    ]);

    return c.json({ success: true, output });
  } catch (error) {
    logger.error("Failed to push", { sessionId, error });
    return c.json({ error: "Failed to push to remote" }, 500);
  }
});

/**
 * POST /api/sessions/:id/pr
 * Create a pull request
 */
sessions.post("/:id/pr", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = await c.req.json();

  const parsed = prSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId },
    include: { user: true },
  });

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  try {
    // Extract owner/repo from repoUrl
    const match = session.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match || !match[1] || !match[2]) {
      return c.json({ error: "Invalid repository URL" }, 400);
    }

    const owner = match[1];
    const repo = match[2];
    const repoName = repo.replace(/\.git$/, "");

    // Decrypt GitHub token
    const githubToken = decryptToken(session.user.accessToken);

    // Create PR via GitHub API
    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: parsed.data.title,
        body: parsed.data.body,
        head: session.branch,
        base: session.baseBranch,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error("GitHub PR creation failed", { sessionId, error });
      return c.json({ error: "Failed to create pull request", details: error }, 500);
    }

    const pr = (await response.json()) as { html_url: string; number: number };

    return c.json({
      success: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
    });
  } catch (error) {
    logger.error("Failed to create PR", { sessionId, error });
    return c.json({ error: "Failed to create pull request" }, 500);
  }
});

/**
 * GET /api/sessions/:id/status
 * Get git status for a session
 */
sessions.get("/:id/status", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: auth.userId, status: "running" },
  });

  if (!session || !session.containerId) {
    return c.json({ error: "Session not found or not running" }, 404);
  }

  try {
    const status = await containerManager.execInContainer(session.containerId, [
      "git",
      "status",
      "--porcelain",
    ]);

    const branch = await containerManager.execInContainer(session.containerId, [
      "git",
      "branch",
      "--show-current",
    ]);

    const ahead = await containerManager.execInContainer(session.containerId, [
      "git",
      "rev-list",
      "--count",
      `origin/${session.branch}..HEAD`,
    ]).catch(() => "0");

    return c.json({
      branch: branch.trim(),
      changes: status
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(3),
        })),
      commitsAhead: parseInt(ahead.trim(), 10) || 0,
    });
  } catch (error) {
    logger.error("Failed to get status", { sessionId, error });
    return c.json({ error: "Failed to get git status" }, 500);
  }
});

export { sessions as sessionRoutes };
