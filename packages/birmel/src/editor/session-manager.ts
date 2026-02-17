import { prisma } from "../database/index.js";
import { loggers } from "../utils/index.js";
import { getMaxSessionDuration, getMaxSessionsPerUser } from "./config.js";
import { cleanupClone } from "./repo-clone.js";
import {
  SessionState,
  type CreateSessionParams,
  type EditorSession,
  type FileChange,
  type PendingChanges,
} from "./types.js";

const logger = loggers.editor.child("session-manager");

/**
 * Get a session by ID
 */
export async function getSession(
  sessionId: string,
): Promise<EditorSession | null> {
  return prisma.editorSession.findUnique({
    where: { id: sessionId },
  });
}

/**
 * Get active sessions for a user
 */
export async function getActiveSessionsForUser(
  userId: string,
): Promise<EditorSession[]> {
  return prisma.editorSession.findMany({
    where: {
      userId,
      state: SessionState.ACTIVE,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Get active session count for a user
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  return prisma.editorSession.count({
    where: {
      userId,
      state: SessionState.ACTIVE,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Check if user can create a new session
 */
export async function canCreateSession(userId: string): Promise<boolean> {
  const count = await getActiveSessionCount(userId);
  return count < getMaxSessionsPerUser();
}

/**
 * Get or create a session for a user in a specific context
 */
export async function getOrCreateSession(
  params: CreateSessionParams,
): Promise<EditorSession> {
  // Check for existing active session with same context
  const existing = await prisma.editorSession.findFirst({
    where: {
      userId: params.userId,
      guildId: params.guildId,
      channelId: params.channelId,
      repoName: params.repoName,
      state: SessionState.ACTIVE,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing != null) {
    logger.debug("Found existing session", { sessionId: existing.id });
    return existing;
  }

  // Check session limit
  const canCreate = await canCreateSession(params.userId);
  if (!canCreate) {
    throw new Error(
      `Maximum sessions per user (${String(getMaxSessionsPerUser())}) reached`,
    );
  }

  // Create new session
  const expiresAt = new Date(Date.now() + getMaxSessionDuration());
  const session = await prisma.editorSession.create({
    data: {
      userId: params.userId,
      guildId: params.guildId,
      channelId: params.channelId,
      threadId: params.threadId ?? null,
      repoName: params.repoName,
      state: SessionState.ACTIVE,
      expiresAt,
    },
  });

  logger.info("Created new session", {
    sessionId: session.id,
    userId: params.userId,
    repoName: params.repoName,
  });

  return session;
}

/**
 * Update session with SDK session ID
 */
export async function updateSdkSessionId(
  sessionId: string,
  sdkSessionId: string,
): Promise<EditorSession> {
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { sdkSessionId },
  });
}

/**
 * Update session with cloned repo path
 */
export async function updateClonedRepoPath(
  sessionId: string,
  clonedRepoPath: string,
): Promise<EditorSession> {
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { clonedRepoPath },
  });
}

/**
 * Store pending changes for a session
 */
export async function storePendingChanges(
  sessionId: string,
  changes: FileChange[],
  branchName: string,
  baseBranch: string,
): Promise<EditorSession> {
  const pendingChanges: PendingChanges = {
    changes,
    branchName,
    baseBranch,
  };

  return prisma.editorSession.update({
    where: { id: sessionId },
    data: {
      pendingChanges: JSON.stringify(pendingChanges),
      state: SessionState.PENDING_APPROVAL,
    },
  });
}

/**
 * Get pending changes for a session
 */
export function getPendingChanges(
  session: EditorSession,
): PendingChanges | null {
  if (session.pendingChanges == null || session.pendingChanges.length === 0) {
    return null;
  }
  try {
    return JSON.parse(session.pendingChanges) as PendingChanges;
  } catch {
    logger.error("Failed to parse pending changes", undefined, {
      sessionId: session.id,
    });
    return null;
  }
}

/**
 * Update session state
 */
export async function updateSessionState(
  sessionId: string,
  state: string,
): Promise<EditorSession> {
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { state },
  });
}

/**
 * Update session with message ID (for button interactions)
 */
export async function updateMessageId(
  sessionId: string,
  messageId: string,
): Promise<EditorSession> {
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { messageId },
  });
}

/**
 * Update session with summary
 */
export async function updateSummary(
  sessionId: string,
  summary: string,
): Promise<EditorSession> {
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { summary },
  });
}

/**
 * Update session with PR URL and cleanup cloned repo
 */
export async function updatePrUrl(
  sessionId: string,
  prUrl: string,
): Promise<EditorSession> {
  const session = await prisma.editorSession.findUnique({
    where: { id: sessionId },
    select: { clonedRepoPath: true },
  });

  // Cleanup cloned repo since PR is created
  if (session?.clonedRepoPath != null && session.clonedRepoPath.length > 0) {
    await cleanupClone(session.clonedRepoPath);
  }

  return prisma.editorSession.update({
    where: { id: sessionId },
    data: {
      prUrl,
      state: SessionState.PR_CREATED,
      clonedRepoPath: null, // Clear the path since we cleaned up
    },
  });
}

/**
 * Cleanup cloned repo for a session
 */
export async function cleanupSessionClone(sessionId: string): Promise<void> {
  const session = await prisma.editorSession.findUnique({
    where: { id: sessionId },
    select: { clonedRepoPath: true },
  });

  if (session?.clonedRepoPath != null && session.clonedRepoPath.length > 0) {
    await cleanupClone(session.clonedRepoPath);
    await prisma.editorSession.update({
      where: { id: sessionId },
      data: { clonedRepoPath: null },
    });
  }
}

/**
 * Expire old sessions and cleanup cloned repos
 */
export async function expireOldSessions(): Promise<number> {
  // First, find sessions to expire so we can cleanup their repos
  const sessionsToExpire = await prisma.editorSession.findMany({
    where: {
      state: SessionState.ACTIVE,
      expiresAt: { lt: new Date() },
    },
    select: { id: true, clonedRepoPath: true },
  });

  // Cleanup cloned repos
  for (const session of sessionsToExpire) {
    if (session.clonedRepoPath != null && session.clonedRepoPath.length > 0) {
      await cleanupClone(session.clonedRepoPath);
    }
  }

  // Update session states
  const result = await prisma.editorSession.updateMany({
    where: {
      state: SessionState.ACTIVE,
      expiresAt: { lt: new Date() },
    },
    data: { state: SessionState.EXPIRED },
  });

  if (result.count > 0) {
    logger.info("Expired sessions", { count: result.count });
  }

  return result.count;
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.editorSession.delete({
    where: { id: sessionId },
  });
}

/**
 * Extend session expiration
 */
export async function extendSession(sessionId: string): Promise<EditorSession> {
  const expiresAt = new Date(Date.now() + getMaxSessionDuration());
  return prisma.editorSession.update({
    where: { id: sessionId },
    data: { expiresAt },
  });
}
