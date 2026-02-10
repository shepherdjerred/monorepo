

/**
 * Represents a file change captured from Claude Agent SDK
 */
export type FileChange = {
  filePath: string;
  oldContent: string | null;
  newContent: string | null;
  changeType: "create" | "modify" | "delete";
}

/**
 * Result from executing an edit with Claude Agent SDK
 */
export type EditResult = {
  sdkSessionId: string | null;
  changes: FileChange[];
  summary: string;
}

/**
 * Session creation parameters
 */
export type CreateSessionParams = {
  userId: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  repoName: string;
}

/**
 * Pending changes stored as JSON in the session
 */
export type PendingChanges = {
  changes: FileChange[];
  branchName: string;
  baseBranch: string;
}

/**
 * Session state enum values (stored as strings in DB)
 */
export const SessionState = {
  ACTIVE: "active",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  PR_CREATED: "pr_created",
} as const;

export type SessionStateType = (typeof SessionState)[keyof typeof SessionState];

/**
 * Re-export Prisma types for convenience
 */


export {type EditorSession, type GitHubAuth} from "@prisma/client";